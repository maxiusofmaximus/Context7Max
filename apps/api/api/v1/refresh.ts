import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getLibrary } from "@ctx7max/core";
import { getSupabase, isAdmin } from "../../lib/auth.js";
import { apiError, handleOptions, json } from "../../lib/http.js";
import { enqueueIngestion } from "../../lib/queue.js";

export const maxDuration = 30;

/**
 * POST /api/v1/refresh  { "libraryId": "/org/repo" }
 * Re-ingests a library (Context7-compatible path).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "Use POST");
  if (!isAdmin(req)) {
    return apiError(res, 403, "forbidden", "Admin key required (CTX7MAX_ADMIN_KEY)");
  }

  const body = (req.body ?? {}) as { libraryId?: string };
  const libraryId = body.libraryId?.trim();
  if (!libraryId || !libraryId.startsWith("/")) {
    return apiError(res, 400, "validation_error", "Body must include { libraryId: \"/org/repo\" }");
  }

  const library = await getLibrary(getSupabase(), libraryId);
  if (!library) {
    return apiError(res, 404, "library_not_found", `Library "${libraryId}" not found`);
  }

  try {
    await enqueueIngestion(library.source_url, "api", { libraryId: library.id });
    return json(res, 202, { status: "queued", libraryId: library.id });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
