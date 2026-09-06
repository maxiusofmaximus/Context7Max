# AGENTS.md — Context7Max

## Qué es esto

Clon self-hosted e ilimitado de Context7 (upstash/context7): indexa documentación de
librerías (GitHub / llms.txt / webs / OpenAPI), extrae snippets de código verbatim y
los sirve por API REST + CLI + MCP a agentes de IA.

## Estructura (monorepo pnpm)

- `packages/core` — tipos, parser (remark MD/MDX + RST + ipynb), schema `context7max.json`,
  filtros de paths, cliente Supabase, formato de respuestas. **Sin I/O de red.**
- `packages/ingestor` — crawlers por fuente + pipeline (fetch→parse→dedup→cap→embed→upsert).
  Depende de core. `website` usa jsdom y se importa de forma PEREZOSA (dinámica) —
  no rompas eso, el CLI se bundlea sin jsdom.
- `packages/cli` — `ctx7max` (commander). Build = bundle CJS self-contained
  (noExternal) vía tsup → el bin no tiene dependencias runtime.
- `packages/mcp` — servidor MCP stdio (2 tools). Solo habla HTTP con la API.
- `apps/api` — Vercel serverless functions (`api/**/*.ts`) + dashboard en `public/`.
  Runtime Node, `@vercel/node` (VercelRequest/VercelResponse). No añadir rutas
  fuera de `api/`.
- `supabase/` — migraciones SQL + Edge Function `embed` (Deno, gte-small vía
  `Supabase.ai.Session`). Deno ≠ Node: no importes paquetes npm ahí.
- `scripts/` — worker de Actions, seed de catálogo, smoke tests (corren con tsx).

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
