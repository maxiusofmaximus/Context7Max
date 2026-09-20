import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  embedQuery,
  getDecisionSpec,
  listDecisionDomains,
  searchDecisionSpecs,
} from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../lib/http.js";

export const maxDuration = 30;

/**
 * GET /api/v2/decisions?domain=security&q=triage
 * GET /api/v2/decisions?id=prompt-injection-audit
 * GET /api/v2/decisions          → dominios disponibles
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
  const id = String(req.query.id ?? "").trim();
  const q = String(req.query.q ?? "").trim();
  const domain = String(req.query.domain ?? "").trim() || null;
  const fast = String(req.query.fast ?? "false") === "true";

  try {
    if (id) {
      const spec = await getDecisionSpec(db, id);
      if (!spec) return apiError(res, 404, "spec_not_found", `Spec "${id}" not found`);
      return json(res, 200, spec);
    }
    if (!q) {
      const domains = await listDecisionDomains(db);
      return json(res, 200, { domains });
    }
    const env = {
      supabaseUrl: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    };
    const embedding = fast ? null : await embedQuery(env, q);
    const results = await searchDecisionSpecs(db, { query: q, domain, embedding, fast });
    return json(res, 200, { query: q, mode: fast || !embedding ? "fts" : "hybrid", results });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
