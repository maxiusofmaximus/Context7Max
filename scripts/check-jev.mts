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

for (const term of ["typesafe", "jev", "laya", "semif", "system-one", "receptron"]) {
  const { data } = await db
    .from("skills")
    .select("id, name")
    .or(`id.ilike.%${term}%,name.ilike.%${term}%`);
  console.log(`${term}: ${data?.length ?? 0}`);
  (data ?? []).slice(0, 4).forEach((s) => console.log(`   - ${s.id}`));
}

// catálogo system-one
const { data: cat } = await db
  .from("catalog")
  .select("id, title")
  .contains("tags", ["system-one"]);
console.log(`\nCatálogo system-one: ${cat?.length ?? 0}`);
(cat ?? []).slice(0, 6).forEach((c) => console.log(`  · ${c.id}`));
