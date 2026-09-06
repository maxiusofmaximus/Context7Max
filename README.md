# Context7Max 🔥

**Tu propio Context7 — ilimitado, gratis y self-hosted.**
Supabase (Postgres + pgvector + Edge Functions) · Vercel (API) · GitHub (repo + Actions).

Context7Max indexa la documentación real de librerías, frameworks, CLIs y APIs, extrae los **ejemplos de código verbatim** y los sirve a tu agente de IA con búsqueda híbrida (vectorial + full-text). Así el agente **copia código real de la documentación** en vez de alucinar APIs viejas — y sin los límites de cuota de Context7.

```
┌──────────┐   ctx7max library "next.js" "middleware auth"
│  tú /    │ ───────────────────────────────────────────────▶
│ agente   │   ctx7max docs /vercel/next.js "redirect a /login"
└─────┬────┘ ◀────────────── snippets verbatim + fuentes ──────
      │
      ▼                ┌────────────────────┐
  ┌────────┐  HTTPS    │  apps/api (Vercel) │────┐
  │  CLI   ├──────────▶│ /api/v2/libs/search│    │
  │ ctx7max│           │ /api/v2/context    │    │
  └────────┘           │ /api/v2/add · etc. │    ▼
                       └────────┬───────────┘  ┌───────────────────────┐
                                │              │ Supabase Edge Function │
                                │ RPC/SQL      │ embed (gte-small, IA   │
                                ▼              │ integrada, gratis)     │
                       ┌────────────────────┐  └───────────────────────┘
                       │ Supabase Postgres  │
                       │ pgvector + FTS     │
                       └────────┬───────────┘
                                ▲
              ┌─────────────────┴───────────────────┐
              │ Ingesta (CLI local o GitHub Action) │
              │ GitHub zipball · llms.txt · web ·   │
              │ OpenAPI → parser MD/MDX/RST/ipynb   │
              └─────────────────────────────────────┘
```

---

## 🚀 Setup (15 minutos)

### 1. Supabase

1. Crea proyecto gratis en [supabase.com](https://supabase.com) (anota **Project URL**, **service_role key** y **anon key**)
2. Aplica el esquema:
   ```bash
   npx supabase link --project-ref <tu-ref>
   npx supabase db push
   ```
   *(o pega `supabase/migrations/0001_init.sql` en el SQL Editor)*
3. Despliega la función de embeddings (gratis, sin APIs externas):
   ```bash
   npx supabase functions deploy embed
   ```

### 2. GitHub

1. Haz push de este repo (público → Actions gratis ilimitado)
2. En **Settings → Secrets**:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - opcional: `GH_INGEST_TOKEN` (PAT para dispatch inmediato; sin él la cola corre cada hora)
3. En **Settings → Variables**: `CTX7MAX_API_URL` = tu URL de Vercel (para keep-alive)

### 3. Vercel

1. Importa el repo, **Root Directory: `apps/api`**, Framework: *Other*
2. Build Command: `cd ../.. && pnpm install && pnpm --filter @ctx7max/core build`
3. Env vars:
   | Var | Para qué |
   |---|---|
   | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | BD + embeddings |
   | `CTX7MAX_API_KEY` | clave de lectura: `ctx7mk-<random-largo>` |
   | `CTX7MAX_ADMIN_KEY` | clave admin (ingesta/refresh) |
   | `GH_DISPATCH_TOKEN` + `GH_REPO` (`tu-usuario/Context7Max`) | dispatch inmediato de ingesta |

### 4. CLI

```bash
git clone https://github.com/<tu-usuario>/Context7Max.git
cd Context7Max
pnpm install && pnpm build
npm i -g ./packages/cli        # registra `ctx7max`

ctx7max config \
  --api-url https://<tu-app>.vercel.app \
  --api-key ctx7mk-... --admin-key ... \
  --supabase-url https://<ref>.supabase.co --supabase-key <service_role>

ctx7max doctor                 # diagnóstico completo
ctx7max setup                  # instala el skill para tu agente (opencode/claude/universal)
```

### 5. Sembrar el catálogo

```bash
# ~60 librerías top resolubles de inmediato
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/seed-catalog.mts
# + ~1400 fuentes llms.txt del hub (opcional):
SUPABASE_URL=... pnpm tsx scripts/seed-catalog.mts --hub
```

---

## 🧠 Uso

### Flujo de 2 pasos (idéntico a Context7)

```bash
ctx7max library "react" "cómo limpiar un useEffect async"
#   → 1. React — /facebook/react — indexada · 2.5k snippets · trust 10

ctx7max docs /facebook/react "cómo limpiar un useEffect async"
#   → snippets verbatim con fuente, lenguaje y presupuesto de tokens
```

| Comando | Qué hace |
|---|---|
| `ctx7max library <nombre> "<query>"` | Busca/resuelve IDs (`--json`) |
| `ctx7max docs <id> "<query>"` | Docs relevantes (`--json`, `--fast`, `--max-tokens N`) |
| `ctx7max add <url>` | Indexa repo GitHub, llms.txt, sitio web u OpenAPI (`--remote` = Action) |
| `ctx7max preview <url>` | Dry-run: archivos que se indexarían |
| `ctx7max list` / `status <id>` | Inventario y estado |
| `ctx7max refresh <id>` | Re-indexar (con `--local` en tu máquina) |
| `ctx7max remove <id> --yes` | Eliminar |
| `ctx7max doctor` | Diagnóstico de toda la cadena |
| `ctx7max setup` | Instala el skill del agente |
| `ctx7max mcp` | Servidor MCP local (stdio) |

### API REST (compatible con Context7 v2)

```bash
curl "https://<app>.vercel.app/api/v2/libs/search?libraryName=react&query=hooks" \
  -H "Authorization: Bearer ctx7mk-..."

curl "https://<app>.vercel.app/api/v2/context?libraryId=/facebook/react&query=useEffect%20cleanup&type=txt" \
  -H "Authorization: Bearer ctx7mk-..."

curl -X POST "https://<app>.vercel.app/api/v2/add" \
  -H "Authorization: Bearer <admin>" -d '{"url": "https://github.com/honojs/hono"}'
```

### MCP

Tu `mcp.json` (Claude Code, Cursor…):

```json
{
  "mcpServers": {
    "context7max": {
      "command": "ctx7max",
      "args": ["mcp"],
      "env": {
        "CTX7MAX_API_URL": "https://<app>.vercel.app",
        "CTX7MAX_API_KEY": "ctx7mk-..."
      }
    }
  }
}
```

Tools expuestas: `resolve-library-id`, `query-docs` (mismo contrato que Context7).

---

## ⚙️ Cómo funciona por dentro

- **Ingesta**: zipball de GitHub / llms.txt / sitemap+Readability / OpenAPI → archivos `.md/.mdx/.rst/.txt/.ipynb` filtrados por `context7max.json` (compatible con `context7.json`: `folders`, `excludeFolders`, `excludeFiles`, `rules`, `previousVersions`) + exclusiones sensatas (CHANGELOG, i18n, blogs, `node_modules`, `.claude`...).
- **Parser**: AST markdown (remark) → snippets de código con título=heading, descripción=párrafo previo, breadcrumb, líneas y URL fuente. Prosa agrupada en chunks. Dedup por hash SHA-256. Nada se reescribe: **siempre verbatim con procedencia**.
- **Embeddings**: `gte-small` (384 dims) corriendo en la Edge Function de Supabase — gratis e ilimitado para este uso. Híbrido: `0.7·cosine + 0.3·ts_rank`, modo `--fast` = solo FTS.
- **Estados transparentes**: cada ingesta es un `job` con estado visible (`queued → parsing → embedding → finalized/error`).
- **Frescura**: `repo_sha` por librería; worker horario re-ingesta lo viejo (>7 días) + `refresh` manual.
- **Sin context-bloat**: `maxTokens` (defecto 4.000) reparte presupuesto 70% código / 30% prosa.
- **Seguridad**: contenido indexado tratado como *untrusted*; `rules` marcadas como terceros; API con clave + rate limit; errores sin internals.

## 📁 Estructura

```
apps/api        → Vercel (serverless functions + dashboard)
packages/core   → tipos, parser, config, DB client, formato Context7
packages/ingestor → crawlers (github/llmstxt/website/openapi) + pipeline
packages/cli    → ctx7max (self-contained, npm i -g ./packages/cli)
packages/mcp    → servidor MCP stdio
supabase/       → migración + edge function embed
scripts/        → worker (Actions), seed catálogo, smoke tests
.github/        → ingest + keepalive
```

## 🔐 Límites reales del free tier (y escapes)

| Recurso | Gratis | Escape |
|---|---|---|
| Supabase DB | 500 MB (~50-80 librerías grandes) | 2º proyecto gratis / caps por librería |
| Edge Functions | 500k invoc./mes | embeddings locales (`--no-embed` + FTS) |
| Vercel Hobby | 100 GB bandwidth | — de sobra |
| Actions | Ilimitado (repo público) | ingesta local con CLI |

## Licencia

MIT. Hecho para tu flujo, no para revender.
