import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchLibraries, toSearchResponse } from "@ctx7max/core";
import { getSupabase, isAuthorized, rateLimit } from "../../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../../lib/http.js";

export const maxDuration = 30;

/**
 * GET /api/v2/libs/search?libraryName=react&query=hooks
 * Context7-compatible response shape.
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
    return apiError(res, 401, "invalid_api_key", "Missing or invalid API key (Authorization: Bearer …)");
  }

  const libraryName = String(req.query.libraryName ?? "").trim();
  const query = String(req.query.query ?? "").slice(0, 500);
  if (!libraryName) {
    return apiError(res, 400, "validation_error", "libraryName is required");
  }

  try {
    const rows = await searchLibraries(getSupabase(), libraryName, query, 8);
    if (rows.length === 0) {
      return json(res, 200, { results: [], searchFilterApplied: false });
    }
    return json(res, 200, toSearchResponse(rows));
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
