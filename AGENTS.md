# AGENTS.md — Context7Max

## Qué es esto

Clon self-hosted e ilimitado de Context7 (upstash/context7) + base de conocimiento
estructurada del desarrollo: indexa documentación de librerías (GitHub / llms.txt /
webs / OpenAPI / git genérico / PDFs / wikis MediaWiki), extrae snippets verbatim,
y además indexa **guías paso a paso** (roadmap.sh, OSSU, freeCodeCamp, Odin,
FullStackOpen, missing-semester), **skills de agentes** (ui-skills + repos GitHub)
y **servidores MCP** (registry oficial + smithery). Todo servido por API REST +
CLI + MCP a agentes de IA.

## Estructura (monorepo pnpm)

- `packages/core` — tipos, parser (remark MD/MDX + RST + AsciiDoc + ipynb), schema
  `context7max.json`, filtros de paths, cliente Supabase, formatos. **Sin I/O de red.**
- `packages/ingestor` — crawlers por fuente (github/llmstxt/website/openapi/git/pdf/wiki)
  + pipeline (fetch→parse→dedup→cap→embed→upsert) + `knowledge.ts` (guides/skills/mcps).
  `website` usa jsdom y se importa de forma PEREZOSA — no rompas eso.
- `packages/cli` — `ctx7max` (commander). Build = bundle CJS self-contained vía tsup.
- `packages/mcp` — servidor MCP stdio (4 tools: resolve-library-id, query-docs,
  search-guides, search-skills). Solo habla HTTP con la API.
- `apps/api` — fuentes de endpoints Vercel en `src/`; `build.mjs` los bundlea
  (esbuild CJS self-contained) a **la raíz `api/`** commiteada — el proyecto Vercel
  es la RAÍZ del repo. Dashboard = `public/index.html`.
- `supabase/` — migraciones SQL (0001 librerías+RAG · 0004 capas de conocimiento)
  + Edge Function `embed` (Deno, gte-small vía `Supabase.ai.Session`).
- `scripts/` — worker de Actions, seeds (catálogo/dominios), smoke tests (tsx).

## Convenciones

- TypeScript ESM estricto en packages; salida CLI/funciones en CJS bundleado.
- Tests: `node --test` vía tsx (`packages/*/test/*.test.ts`). Sin frameworks.
- Búsqueda en RPC SQL de Postgres (`match_context`, `search_libraries`,
  `search_guides`, `search_skills`) — NO reimplementar ranking en la API.
- tsquery se construye con semántica OR (términos relevantes), no AND.
- Respuestas de API compatibles con Context7 v2 (`{error, message}`).
- Snippets y guías SIEMPRE verbatim con provenance y `license` registrada.
- Secrets por env; nunca en código. `SUPABASE_SERVICE_ROLE_KEY` solo server-side.

## Comandos

```bash
pnpm install && pnpm build           # todo el monorepo
pnpm --filter @ctx7max/core test     # tests del parser
node packages/cli/dist/cli.cjs doctor
pnpm tsx scripts/smoke-preview.mts <url>
pnpm tsx scripts/db-check.mts        # conteos de tablas

# capas de conocimiento (local, con config de ctx7max)
node packages/cli/dist/cli.cjs ingest guides [fuente]   # roadmap.sh por defecto o una
node packages/cli/dist/cli.cjs ingest skills
node packages/cli/dist/cli.cjs ingest mcps

# endpoints nuevos (tras node apps/api/build.mjs + vercel deploy --prod)
/api/v2/guides?q=&domain=   /api/v2/skills?q=|id=   /api/v2/mcps?q=
```

## Deploy

- Supabase: `supabase db push` + `supabase functions deploy embed`
- Vercel (raíz): `node apps/api/build.mjs && vercel deploy --prod`
- Actions: secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; variable `CTX7MAX_API_URL`

## Convenciones

- TypeScript ESM estricto en packages; salida CLI en CJS (tsup sólo empaqueta).
- Tests: `node --test` vía tsx (`packages/*/test/*.test.ts`). Sin frameworks.
- Toda la lógica de búsqueda vive en RPC SQL de Postgres (`match_context`,
  `search_libraries`) — NO reimplementar ranking en la API.
- Respuestas de API compatibles con Context7 v2 (`{error, message}`, shapes de
  search/context). No romper nombres de campos.
- Snippets SIEMPRE verbatim con provenance (file, líneas, URL, hash). Está
  prohibido resumir/parafrasear contenido indexado en la ingesta.
- Secrets por env; nunca en código. `SUPABASE_SERVICE_ROLE_KEY` solo server-side.

## Comandos

```bash
pnpm install
pnpm build                      # todos los paquetes (orden topo)
pnpm --filter @ctx7max/core test
node packages/cli/dist/cli.cjs doctor
pnpm tsx scripts/smoke-preview.mts https://github.com/colinhacks/zod
```

## Deploy

- Supabase: `supabase db push` + `supabase functions deploy embed`
- Vercel: root `apps/api`, build `cd ../.. && pnpm install && pnpm --filter @ctx7max/core build`
- Actions: secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; variable `CTX7MAX_API_URL`
