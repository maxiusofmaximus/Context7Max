import type { VercelRequest, VercelResponse } from "@vercel/node";
import { embedQuery, listGuideDomains, searchGuides } from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../lib/http.js";

export const maxDuration = 45;

/**
 * GET /api/v2/guides                     → dominios disponibles
 * GET /api/v2/guides?query=..&domain=..  → búsqueda híbrida de guías paso a paso
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  corsRead(res);
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "Use GET");

  const rl = rateLimit(req);
  if (rl.limited) {
    res.setHeader("Retry-After", rl.retryAfter);
    return apiError(res, 429, "rate_limit_exceeded", "Rate limit exceeded");
  }
  if (!(await isAuthorized(req))) {
    return apiError(res, 401, "invalid_api_key", "Missing or invalid API key");
  }

  const db = getSupabase();
  const query = String(req.query.query ?? "").trim();
  const domain = String(req.query.domain ?? "").trim() || null;
  const fast = String(req.query.fast ?? "false") === "true";
  const limit = Math.min(parseInt(String(req.query.limit ?? ""), 10) || 25, 60);

  try {
    // Sin query → devolver el mapa de dominios/tracks disponibles
    if (!query) {
      const domains = await listGuideDomains(db);
      const grouped: Record<string, { sources: string[]; guides: number }> = {};
      for (const d of domains) {
        grouped[d.domain] ??= { sources: [], guides: 0 };
        grouped[d.domain]!.sources.push(d.source);
        grouped[d.domain]!.guides += d.count;
      }
      return json(res, 200, { domains: grouped });
    }

    const env = {
      supabaseUrl: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    };
    const embedding = fast ? null : await embedQuery(env, query);
    const guides = await searchGuides(db, { query, domain, embedding, limit, fast });

    return json(res, 200, {
      query,
      domain,
      mode: fast || !embedding ? "fts" : "hybrid",
      results: guides,
    });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
