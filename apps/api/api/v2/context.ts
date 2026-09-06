import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  embedQuery,
  formatContextTxt,
  getLibrary,
  matchContext,
  toContextResponse,
  DEFAULT_MAX_TOKENS,
} from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../lib/http.js";
import { enqueueIngestion } from "../../lib/queue.js";

export const maxDuration = 60;

const RESERVED_PREFIXES = new Set([
  "websites",
  "llmstxt",
  "openapi",
  "packages",
  "npm",
  "docs",
]);

/** "/vercel/next.js/v15.1.8" | "/vercel/next.js@v15.1.8" → { id, version } */
export function parseLibraryId(raw: string): {
  id: string;
  version: string | null;
} | null {
  let s = raw.trim();
  if (!s.startsWith("/")) s = `/${s}`;
  let version: string | null = null;
  const atIdx = s.indexOf("@");
  if (atIdx > 0) {
    version = s.slice(atIdx + 1) || null;
    s = s.slice(0, atIdx);
  }
  const segs = s.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const base = RESERVED_PREFIXES.has(segs[0]!)
    ? `/${segs[0]}/${segs[1]}`
    : `/${segs[0]}/${segs[1]}`;
  if (segs.length > 2) version = segs.slice(2).join("/");
  return { id: base, version };
}

/**
 * GET /api/v2/context?libraryId=/org/repo&query=...&type=txt|json&fast=&maxTokens=
 * Lazy-ingests catalog-only libraries (returns 202 while processing).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  corsRead(res);
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "Use GET");

  const rl = rateLimit(req);
  if (rl.limited) {
    res.setHeader("Retry-After", rl.retryAfter);
    return apiError(res, 429, "rate_limit_exceeded", "Rate limit exceeded. Retry later.");
  }
  if (!(await isAuthorized(req))) {
    return apiError(res, 401, "invalid_api_key", "Missing or invalid API key");
  }

  const raw = String(req.query.libraryId ?? "");
  const query = String(req.query.query ?? "").slice(0, 500);
  const type = String(req.query.type ?? "txt") === "json" ? "json" : "txt";
  const fast = String(req.query.fast ?? "false") === "true";
  const maxTokens = Math.min(
    Math.max(parseInt(String(req.query.maxTokens ?? ""), 10) || DEFAULT_MAX_TOKENS, 500),
    20000,
  );

  if (!query) return apiError(res, 400, "validation_error", "query is required");
  const parsed = parseLibraryId(raw);
  if (!parsed) {
    return apiError(
      res,
      400,
      "invalid_library_id",
      "Invalid library ID format. Expected: /owner/repo or /<source>/<id>",
    );
  }

  const supabase = getSupabase();
  const env = {
    supabaseUrl: process.env.SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const library = await getLibrary(supabase, parsed.id);

  if (!library) {
    // lazy ingestion from catalog
    const { data: cat } = await supabase
      .from("catalog")
      .select("*")
      .eq("id", parsed.id)
      .maybeSingle();
    if (cat) {
      await enqueueIngestion(cat.source_url, "api");
      return apiError(
        res,
        202,
        "library_processing",
        `Library ${parsed.id} found in catalog and queued for ingestion. Retry in a minute.`,
      );
    }
    return apiError(
      res,
      404,
      "library_not_found",
      `Library "${parsed.id}" not found. Add it with: ctx7max add <github-url|llms.txt|website>`,
    );
  }

  if (library.state === "error") {
    return apiError(
      res,
      422,
      "library_error",
      `Library ${parsed.id} failed to index: ${library.state_message ?? "unknown error"}`,
    );
  }
  if (library.state !== "finalized") {
    return apiError(
      res,
      202,
      "library_not_finalized",
      `Library ${parsed.id} is ${library.state}. Retry shortly.`,
    );
  }

  try {
    // query vector unless fast mode
    let embedding: number[] | null = null;
    if (!fast) {
      embedding = await embedQuery(env, query);
    }
    const match = await matchContext(supabase, {
      libraryId: parsed.id,
      version: parsed.version,
      query,
      embedding,
      maxTokens,
      fast,
    });

    if (match.codeSnippets.length === 0 && match.infoSnippets.length === 0) {
      return apiError(
        res,
        404,
        "no_snippets_found",
        `No relevant documentation found in ${parsed.id} for that query.`,
      );
    }

    const resp = toContextResponse(
      match,
      {
        libraryId: parsed.id,
        version: parsed.version ?? "main",
        query,
        mode: fast || !embedding ? "fts" : "hybrid",
        returnedTokens:
          match.codeSnippets.reduce((a, s) => a + s.tokens, 0) +
          match.infoSnippets.reduce((a, s) => a + s.tokens, 0),
        maxTokens,
        stale: false,
        lastIndexedAt: library.last_update_at ?? null,
      },
      library.rules,
    );

    if (type === "json") return json(res, 200, resp);
    res.status(200).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(formatContextTxt(resp));
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
