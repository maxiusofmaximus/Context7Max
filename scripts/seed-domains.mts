/**
 * Seed de dominios: añade las fuentes canónicas al catálogo con su dominio,
 * usando la fuente única de verdad: DOMAIN_SOURCES de @ctx7max/core
 * (la misma que usa `ctx7max add --pack <dominio>`).
 *
 * Uso: pnpm tsx scripts/seed-domains.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, upsertCatalog, DOMAIN_SOURCES, type CatalogRow, type DbEnv } from "@ctx7max/core";

const cfg = JSON.parse(
  readFileSync(join(process.env.APPDATA ?? "", "ctx7max", "config.json"), "utf8"),
) as Record<string, string>;
const env: DbEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? cfg.supabaseUrl ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? cfg.supabaseServiceRoleKey ?? "",
};

function toCatalogRow(domain: string, url: string): CatalogRow {
  if (url.includes("github.com")) {
    const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/)!;
    return {
      id: `/${m[1]}/${m[2]!.replace(/\.git$/, "")}`,
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
for (const [domain, urls] of Object.entries(DOMAIN_SOURCES)) {
  for (const url of urls) rows.push(toCatalogRow(domain, url));
}
const seen = new Set<string>();
const unique = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));

await upsertCatalog(createDb(env), unique);
console.log(`✓ ${unique.length} fuentes de dominios en el catálogo`);
