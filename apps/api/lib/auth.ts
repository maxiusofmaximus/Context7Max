import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function bearerToken(req: VercelRequest): string | null {
  const h = req.headers.authorization ?? "";
  const m = h.match(/^bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

let supabase: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

/**
 * Reader auth: master key (CTX7MAX_API_KEY) or any key present in api_keys.
 * Anonymous is rejected — it's YOUR unlimited instance, not a public freebie.
 */
export async function isAuthorized(req: VercelRequest): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) return false;
  if (process.env.CTX7MAX_API_KEY && token === process.env.CTX7MAX_API_KEY)
    return true;
  try {
    const { data, error } = await getSupabase()
      .from("api_keys")
      .select("id")
      .eq("key_hash", hashKey(token))
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** Admin auth for mutation endpoints (add/refresh/remove). */
export function isAdmin(req: VercelRequest): boolean {
  const token = bearerToken(req);
  const admin = process.env.CTX7MAX_ADMIN_KEY;
  return !!admin && !!token && token === admin;
}

// ── coarse in-memory rate limit (per warm instance) ────────────────
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  req: VercelRequest,
  limitPerMinute = 120,
): { limited: boolean; retryAfter: number } {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown";
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return { limited: false, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limitPerMinute) {
    return { limited: true, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { limited: false, retryAfter: 0 };
}
