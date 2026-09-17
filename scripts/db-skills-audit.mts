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

const groups = [
  "cloudflare", "vercel", "google", "aws", "azure", "firebase",
  "stripe", "supabase", "auth0", "clerk", "neon", "prisma",
  "security", "pentest", "kubernetes", "terraform", "langchain",
  "expo", "gemini", "openai", "anthropic", "red-team", "osint",
  "incident", "forensic", "vulnerability",
];
const parts: string[] = [];
for (const g of groups) {
  const { count } = await db
    .from("skills")
    .select("id", { count: "exact", head: true })
    .or(`id.ilike.%${g}%,name.ilike.%${g}%`);
  parts.push(`${g}:${count ?? 0}`);
}
console.log(parts.join("  "));

const { count: nulls } = await db
  .from("skills")
  .select("*", { count: "exact", head: true })
  .is("embedding", null);
console.log(`skills sin vector: ${nulls}`);
