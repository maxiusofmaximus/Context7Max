/**
 * Seed de dominios: añade las fuentes canónicas (verificadas en la
 * investigación v3) al catálogo con su dominio, para que `library`
 * las resuelva y la ingesta lazy las indexe al primer uso.
 *
 * Uso:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm tsx scripts/seed-domains.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, upsertCatalog, type CatalogRow, type DbEnv } from "@ctx7max/core";

const cfg = JSON.parse(
  readFileSync(
    join(process.env.APPDATA ?? "", "ctx7max", "config.json"),
    "utf8",
  ),
) as Record<string, string>;
const env: DbEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? cfg.supabaseUrl ?? "",
  serviceRoleKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? cfg.supabaseServiceRoleKey ?? "",
};
if (!env.supabaseUrl || !env.serviceRoleKey) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const raw = JSON.parse(
  readFileSync(new URL("./dominio-fuentes.json", import.meta.url), "utf8"),
) as Record<string, string[]>;

function toCatalogRow(domain: string, url: string): CatalogRow {
  if (url.includes("github.com")) {
    const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/)!;
    return {
      id: `/${m[1]}/${m[2]!}`,
      title: m[2]!.replace(/[-_]+/g, " "),
      description: `Fuente canónica de ${domain}`,
      source_type: "github",
      source_url: url.split("#")[0]!,
      tags: [domain],
      stars: 0,
      trust_score: 8,
    };
  }
  const u = new URL(url);
  if (/llms(-full)?\.txt$/i.test(url)) {
    return {
      id: `/llmstxt/${u.hostname.replace(/^www\./, "").replace(/\./g, "-")}`,
      title: u.hostname.replace(/^www\./, ""),
      description: `Fuente canónica (${domain}) en llms.txt`,
      source_type: "llmstxt",
      source_url: url,
      tags: [domain],
      stars: 0,
      trust_score: 7,
    };
  }
  return {
    id: `/websites/${u.hostname.replace(/^www\./, "").replace(/\./g, "-")}`,
    title: u.hostname.replace(/^www\./, ""),
    description: `Fuente canónica de ${domain}`,
    source_type: "website",
    source_url: url,
    tags: [domain],
    stars: 0,
    trust_score: 7,
  };
}

const rows: CatalogRow[] = [];
for (const [domain, urls] of Object.entries(raw)) {
  for (const url of urls) rows.push(toCatalogRow(domain, url));
}
const seen = new Set<string>();
const unique = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));

await upsertCatalog(createDb(env), unique);
console.log(`✓ ${unique.length} fuentes de dominios añadidas al catálogo`);
