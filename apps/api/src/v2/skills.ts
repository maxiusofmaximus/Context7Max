import type { VercelRequest, VercelResponse } from "@vercel/node";
import { embedQuery, getSkill, searchSkillsRpc } from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../lib/http.js";

export const maxDuration = 45;

/**
 * GET /api/v2/skills?q=react           → búsqueda híbrida de skills
 * GET /api/v2/skills?id=<skill-id>     → skill completa (body SKILL.md)
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
  const query = String(req.query.q ?? "").trim();
  const fast = String(req.query.fast ?? "false") === "true";
  const limit = Math.min(parseInt(String(req.query.limit ?? ""), 10) || 15, 50);

  try {
    if (id) {
      const skill = await getSkill(db, id);
      if (!skill) return apiError(res, 404, "skill_not_found", `Skill "${id}" not found`);
      return json(res, 200, skill);
    }
    if (!query) {
      return apiError(res, 400, "validation_error", "Provide q (search) or id (get)");
    }
    const env = {
      supabaseUrl: process.env.SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    };
    const embedding = fast ? null : await embedQuery(env, query);
    const results = await searchSkillsRpc(db, { query, embedding, limit, fast });
    return json(res, 200, { query, mode: fast || !embedding ? "fts" : "hybrid", results });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
