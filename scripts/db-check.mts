import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, type DbEnv } from "@ctx7max/core";

const cfgPath = join(process.env.APPDATA ?? "", "ctx7max", "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, string>;
const env: DbEnv = {
  supabaseUrl: cfg.supabaseUrl!,
  serviceRoleKey: cfg.supabaseServiceRoleKey!,
};
const db = createDb(env);

for (const table of ["guides", "skills", "mcp_servers", "libraries", "code_snippets", "jobs"] as const) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  console.log(`${table}: ${error ? error.message : count}`);
}
