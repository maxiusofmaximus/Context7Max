import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getLatestJob, getLibrary } from "@ctx7max/core";
import { getSupabase, isAuthorized } from "../../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../../lib/http.js";

export const maxDuration = 15;

/** GET /api/v2/libs/status?libraryId=/org/repo — indexing state + last job */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  corsRead(res);
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "Use GET");
  if (!(await isAuthorized(req))) {
    return apiError(res, 401, "invalid_api_key", "Missing or invalid API key");
  }

  const libraryId = String(req.query.libraryId ?? "").trim();
  if (!libraryId) return apiError(res, 400, "validation_error", "libraryId is required");

  const library = await getLibrary(getSupabase(), libraryId);
  if (!library) return apiError(res, 404, "library_not_found", `Library "${libraryId}" not found`);

  const job = await getLatestJob(getSupabase(), libraryId);
  return json(res, 200, {
    libraryId: library.id,
    state: library.state,
    stateMessage: library.state_message,
    totalSnippets: library.total_snippets,
    totalTokens: library.total_tokens,
    versions: library.versions,
    quality: library.quality,
    lastUpdateAt: library.last_update_at,
    lastJob: job
      ? {
          action: job.action,
          status: job.status,
          stage: job.stage,
          message: job.message,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
        }
      : null,
  });
}
