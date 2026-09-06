import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase, isAuthorized } from "../../../lib/auth.js";
import { apiError, corsRead, handleOptions, json } from "../../../lib/http.js";

export const maxDuration = 15;

/** GET /api/v2/libs/list — indexed libraries + catalog stats (dashboard feed) */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  corsRead(res);
  if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "Use GET");
  if (!(await isAuthorized(req))) {
    return apiError(res, 401, "invalid_api_key", "Missing or invalid API key");
  }

  const db = getSupabase();
  const [libs, cats, jobs] = await Promise.all([
    db
      .from("libraries")
      .select("id,title,description,source_type,state,total_tokens,total_snippets,stars,trust_score,versions,last_update_at,quality")
      .order("total_snippets", { ascending: false }),
    db.from("catalog").select("id", { count: "exact", head: true }),
    db
      .from("jobs")
      .select("id,library_id,action,status,stage,message,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (libs.error) return apiError(res, 500, "internal_error", libs.error.message);

  return json(res, 200, {
    libraries: libs.data,
    catalogSize: cats.count ?? 0,
    recentJobs: jobs.error ? [] : jobs.data,
  });
}
