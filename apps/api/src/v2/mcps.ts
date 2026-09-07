import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchMcpServers } from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../lib/http.js";

export const maxDuration = 15;

/** GET /api/v2/mcps?q=github — servidores MCP conocidos */
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
  const query = String(req.query.q ?? "").trim();
  if (!query) return apiError(res, 400, "validation_error", "q is required");
  try {
    const results = await searchMcpServers(getSupabase(), query, 20);
    return json(res, 200, { query, results });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
