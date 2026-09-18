import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "@ctx7max/core";

const cfg = JSON.parse(
  readFileSync(join(process.env.APPDATA ?? "", "ctx7max", "config.json"), "utf8"),
) as Record<string, string>;
const db = createDb({
  supabaseUrl: cfg.supabaseUrl,
  serviceRoleKey: cfg.supabaseServiceRoleKey,
});

const { data, error } = await db.rpc("db_size_info");
if (error) throw error;
const info = data as { total_mb: number; free_tier_remaining_mb: number; by_table: { table: string; mb: number }[] };
console.log(`\nBD: ${info.total_mb} MB usados · quedan ${info.free_tier_remaining_mb} MB del free tier (500MB)\n`);
for (const t of info.by_table.slice(0, 10)) {
  console.log(`  ${t.table.padEnd(28)} ${t.mb.toString().padStart(10)} MB`);
}
