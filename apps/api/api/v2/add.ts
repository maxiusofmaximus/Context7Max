import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdmin } from "../../lib/auth.js";
import { apiError, handleOptions, json } from "../../lib/http.js";
import { enqueueIngestion } from "../../lib/queue.js";

export const maxDuration = 30;

/**
 * POST /api/v2/add  { "url": "https://github.com/org/repo", "type": "github|llmstxt|website|openapi" }
 * Unified ingestion endpoint (covers Context7's /add/repo/github, /add/llmstxt, …).
 * Returns 202 — ingestion runs asynchronously on the GitHub Action worker.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") return apiError(res, 405, "method_not_allowed", "Use POST");
  if (!isAdmin(req)) {
    return apiError(res, 403, "forbidden", "Admin key required (CTX7MAX_ADMIN_KEY)");
  }

  const body = (req.body ?? {}) as { url?: string; type?: string };
  const url = body.url?.trim();
  if (!url || !/^https?:\/\//.test(url)) {
    return apiError(res, 400, "validation_error", "Body must include a valid { url }");
  }

  try {
    const result = await enqueueIngestion(url, "api");
    return json(res, 202, {
      status: "queued",
      url,
      dispatched: result.dispatched,
    });
  } catch (err) {
    return apiError(res, 500, "internal_error", (err as Error).message);
  }
}
