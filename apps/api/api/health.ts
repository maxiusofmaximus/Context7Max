import type { VercelRequest, VercelResponse } from "@vercel/node";
import { healthCheck } from "@ctx7max/core";
import { getSupabase } from "../lib/auth.js";
import { json } from "../lib/http.js";

export const maxDuration = 15;

/** GET /api/health — public. Also the keep-alive ping target for Supabase free tier. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const health = await healthCheck(getSupabase());
    return json(res, 200, {
      status: "ok",
      service: "context7max",
      version: "0.1.0",
      database: health.ok ? "up" : "degraded",
      libraries: health.libraries,
      snippets: health.snippets,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return json(res, 503, {
      status: "error",
      service: "context7max",
      error: (err as Error).message,
    });
  }
}
