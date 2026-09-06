/**
 * Seed the catalog:
 *  - curated top ~50 dev libraries (canonical GitHub repos)
 *  - optionally: the llms-txt-hub directory (~1.400 llms.txt sources)
 *
 * Usage:
 *   pnpm tsx scripts/seed-catalog.mts            # curated only
 *   pnpm tsx scripts/seed-catalog.mts --hub      # curated + hub
 */
import { createDb, upsertCatalog, type CatalogRow, type DbEnv } from "@ctx7max/core";

const CURATED: [string, string, string[]][] = [
  // [github owner/repo, tags...]  — title/description auto-fetched on ingest;
  // catalog entries help `search` resolve names BEFORE ingestion.
  ["vercel/next.js", ["react", "framework", "ssr"]],
  ["facebook/react", ["ui", "frontend"]],
  ["facebook/react-native", ["mobile"]],
  ["vuejs/core", ["frontend", "framework"]],
  ["sveltejs/svelte", ["frontend"]],
  ["angular/angular", ["frontend"]],
  ["solidjs/solid", ["frontend"]],
  ["withastro/astro", ["ssg", "frontend"]],
  ["remix-run/remix", ["react", "ssr"]],
  ["sveltejs/kit", ["svelte", "framework"]],
  ["tailwindlabs/tailwindcss", ["css"]],
  ["vitejs/vite", ["bundler", "dx"]],
  ["nodejs/node", ["runtime"]],
  ["denoland/deno", ["runtime"]],
  ["oven-sh/bun", ["runtime"]],
  ["expressjs/express", ["http", "node"]],
  ["fastify/fastify", ["http", "node"]],
  ["honojs/hono", ["http", "edge"]],
  ["nestjs/nest", ["backend", "typescript"]],
  ["supabase/supabase", ["database", "backend"]],
  ["prisma/prisma", ["orm", "database"]],
  ["drizzle-team/drizzle-orm", ["orm", "typescript"]],
  ["kysely-org/kysely", ["sql", "typescript"]],
  ["redis/redis", ["cache"]],
  ["elastic/elasticsearch", ["search"]],
  ["mui/material-ui", ["ui", "react"]],
  ["shadcn-ui/ui", ["ui", "react"]],
  ["radix-ui/primitives", ["ui", "a11y"]],
  ["chakra-ui/chakra-ui", ["ui", "react"]],
  ["TanStack/query", ["data", "react"]],
  ["TanStack/router", ["routing", "react"]],
  ["trpc/trpc", ["rpc", "typescript"]],
  ["colinhacks/zod", ["validation"]],
  ["jquense/yup", ["validation"]],
  ["axios/axios", ["http-client"]],
  ["nodejs/undici", ["http-client"]],
  ["reduxjs/redux-toolkit", ["state", "react"]],
  ["pmndrs/zustand", ["state", "react"]],
  ["vuejs/pinia", ["state", "vue"]],
  ["storybookjs/storybook", ["ui", "testing"]],
  ["playwright-community/playwright" /* fallback */, ["testing"]], // real: microsoft/playwright
  ["microsoft/playwright", ["testing", "e2e"]],
  ["cypress-io/cypress", ["testing", "e2e"]],
  ["vitest-dev/vitest", ["testing"]],
  ["jestjs/jest", ["testing"]],
  ["puppeteer/puppeteer", ["automation", "browser"]],
  ["langchain-ai/langchainjs", ["ai", "llm"]],
  ["vercel/ai", ["ai", "llm", "sdk"]],
  ["openai/openai-node", ["ai", "openai"]],
  ["anthropics/anthropic-sdk-typescript", ["ai", "anthropic"]],
  ["supabase/supabase-js", ["supabase", "client"]],
  ["firebase/firebase-js-sdk", ["firebase"]],
  ["stripe/stripe-node", ["payments"]],
  ["graphql/graphql-js", ["graphql"]],
  ["apollographql/apollo-server", ["graphql"]],
  ["microsoft/TypeScript", ["language"]],
  ["python/cpython", ["language"]],
  ["golang/go", ["language"]],
  ["rust-lang/rust", ["language"]],
  ["pallets/flask", ["python", "web"]],
  ["fastapi/fastapi", ["python", "web"]],
  ["django/django", ["python", "web"]],
  ["encode/httpx", ["python", "http"]],
  ["psf/requests", ["python", "http"]],
  ["numpy/numpy", ["python", "data"]],
  ["pandas-dev/pandas", ["python", "data"]],
];

function curatedRows(): CatalogRow[] {
  return CURATED.filter(([repo]) => repo !== "playwright-community/playwright").map(
    ([repo, tags]) => ({
      id: `/${repo}`,
      title: repo.split("/")[1]!,
      description: null,
      source_type: "github",
      source_url: `https://github.com/${repo}`,
      tags,
      stars: 0,
      trust_score: 8,
    }),
  );
}

async function hubRows(): Promise<CatalogRow[]> {
  const url =
    "https://raw.githubusercontent.com/thedaviddias/llms-txt-hub/main/packages/data/websites.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hub fetch failed: ${res.status}`);
  const sites = (await res.json()) as {
    name?: string;
    domain?: string;
    description?: string;
    llmsTxtUrl?: string;
    category?: string;
  }[];
  const rows: CatalogRow[] = [];
  for (const s of sites) {
    const llms = s.llmsTxtUrl;
    if (!llms || !llms.startsWith("http")) continue;
    const host = new URL(llms).hostname.replace(/^www\./, "");
    rows.push({
      id: `/llmstxt/${host.replace(/\./g, "-")}`,
      title: s.name ?? host,
      description: s.description ?? null,
      source_type: "llmstxt",
      source_url: llms,
      tags: s.category ? [s.category] : [],
      stars: 0,
      trust_score: 6,
    });
  }
  return rows;
}

const env: DbEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
if (!env.supabaseUrl || !env.serviceRoleKey) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createDb(env);
const rows = curatedRows();
await upsertCatalog(db, rows);
console.log(`✓ catálogo: ${rows.length} librerías curadas`);

if (process.argv.includes("--hub")) {
  const hub = await hubRows();
  await upsertCatalog(db, hub);
  console.log(`✓ hub llms.txt: ${hub.length} fuentes añadidas`);
}
console.log("Hecho.");
