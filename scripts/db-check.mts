import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type DbEnv } from "@ctx7max/core";

const cfg = JSON.parse(
  readFileSync(join(process.env.APPDATA ?? "", "ctx7max", "config.json"), "utf8"),
) as Record<string, string>;
const env: DbEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? cfg.supabaseUrl ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? cfg.supabaseServiceRoleKey ?? "",
};
const db = createDb(env);

for (const table of ["code_snippets", "info_snippets", "guides", "skills", "libraries", "mcp_servers"] as const) {
  const total = (await db.from(table).select("*", { count: "exact", head: true })).count ?? 0;
  let nulls = 0;
  try {
    nulls = (await db.from(table).select("*", { count: "exact", head: true }).is("embedding", null)).count ?? 0;
  } catch {
    /* table without embedding */
  }
  const pct = total ? Math.round(((total - nulls) / total) * 1000) / 10 : 100;
  console.log(`${table.padEnd(16)} ${String(total).padStart(7)} total · ${String(nulls).padStart(5)} sin vector · ${pct}%`);
}
