import type { McpServerRow } from "@ctx7max/core";
import { fetchText } from "../util.js";

const MAX_ENTRIES = 3000;

/** Official MCP registry — public, no auth. */
export async function fetchOfficialMcpRegistry(): Promise<McpServerRow[]> {
  const out: McpServerRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40 && out.length < MAX_ENTRIES; page++) {
    const url = new URL("https://registry.modelcontextprotocol.io/v0/servers");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const data = JSON.parse(await fetchText(url.toString(), { timeoutMs: 30_000 })) as {
        servers?: (
          | {
              name?: string;
              description?: string;
              repository?: { url?: string } | string;
              remotes?: { url?: string }[];
            }
          | { server?: { name?: string; description?: string; repository?: { url?: string } | string; remotes?: { url?: string }[] } }
        )[];
        metadata?: { nextCursor?: string | null };
      };
      // el registry oficial puede envolver cada entrada en { server: {...} }
      const list = (data.servers ?? []).map((s) => ("server" in s && s.server ? s.server : s)) as {
        name?: string;
        description?: string;
        repository?: { url?: string } | string;
        remotes?: { url?: string }[];
      }[];
      for (const s of list) {
        if (!s.name) continue;
        out.push({
          name: s.name,
          description: s.description ?? null,
          url: s.remotes?.[0]?.url ?? null,
          repo:
            typeof s.repository === "string"
              ? s.repository
              : s.repository?.url ?? null,
          registry: "modelcontextprotocol",
          verified: true,
          use_count: 0,
        });
      }
      cursor = data.metadata?.nextCursor ?? null;
      if (!cursor || list.length === 0) break;
    } catch {
      break;
    }
  }
  return out;
}

/** Smithery registry — public JSON, has useCount popularity signal. */
/** MCP servers creados por creadores/comunidad que NO están en los registries. */
export function curatedMcpServers(): McpServerRow[] {
  return [
    // Oficiales corporativos (registry oficial NO los lista todos — verificado sep-2026)
    { name: "github/github-mcp-server", description: "MCP oficial de GitHub (repos, issues, PRs, code search)", url: "https://api.githubcopilot.com/mcp/", repo: "https://github.com/github/github-mcp-server", registry: "curated", verified: true, use_count: 33000 },
    { name: "microsoft/playwright-mcp", description: "Automatización de navegador (Playwright) para agentes", url: null, repo: "https://github.com/microsoft/playwright-mcp", registry: "curated", verified: true, use_count: 37000 },
    { name: "microsoft/mcp", description: "Azure MCP oficial (hub) — Foundry, ARM, Sentinel, M365", url: null, repo: "https://github.com/microsoft/mcp", registry: "curated", verified: true, use_count: 3700 },
    { name: "MicrosoftDocs/mcp", description: "Microsoft Learn docs vía MCP (remoto gratuito)", url: "https://learn.microsoft.com/api/mcp", repo: "https://github.com/MicrosoftDocs/mcp", registry: "curated", verified: true, use_count: 1900 },
    { name: "awslabs/mcp", description: "Suite oficial de ~40 servidores MCP de AWS", url: null, repo: "https://github.com/awslabs/mcp", registry: "curated", verified: true, use_count: 9700 },
    { name: "google/mcp", description: "Catálogo oficial de servidores MCP de Google Cloud (BigQuery, Spanner…)", url: "https://docs.cloud.google.com/mcp", repo: "https://github.com/google/mcp", registry: "curated", verified: true, use_count: 4600 },
    { name: "googleapis/genai-toolbox", description: "MCP Toolbox for Databases (Google) — IA segura contra tus DBs", url: null, repo: "https://github.com/googleapis/genai-toolbox", registry: "curated", verified: true, use_count: 16400 },
    { name: "ChromeDevTools/chrome-devtools-mcp", description: "Chrome DevTools para agentes (tracing, performance)", url: null, repo: "https://github.com/ChromeDevTools/chrome-devtools-mcp", registry: "curated", verified: true, use_count: 52000 },
    { name: "cloudflare/mcp-server-cloudflare", description: "Cloudflare MCP remoto: docs, workers, observability, AI gateway", url: "https://mcp.cloudflare.com/mcp", repo: "https://github.com/cloudflare/mcp-server-cloudflare", registry: "curated", verified: true, use_count: 4200 },
    { name: "supabase/mcp", description: "MCP oficial de Supabase (antes supabase-community)", url: "https://mcp.supabase.com/mcp", repo: "https://github.com/supabase/mcp", registry: "curated", verified: true, use_count: 2900 },
    { name: "neondatabase/mcp-server-neon", description: "Neon serverless Postgres MCP", url: "https://mcp.neon.tech/mcp", repo: "https://github.com/neondatabase/mcp-server-neon", registry: "curated", verified: true, use_count: 646 },
    { name: "mongodb-js/mongodb-mcp-server", description: "MongoDB Atlas MCP oficial", url: null, repo: "https://github.com/mongodb-js/mongodb-mcp-server", registry: "curated", verified: true, use_count: 1100 },
    { name: "ClickHouse/mcp-clickhouse", description: "ClickHouse warehouse MCP", url: null, repo: "https://github.com/ClickHouse/mcp-clickhouse", registry: "curated", verified: true, use_count: 875 },
    { name: "qdrant/mcp-server-qdrant", description: "Búsqueda vectorial Qdrant MCP", url: null, repo: "https://github.com/qdrant/mcp-server-qdrant", registry: "curated", verified: true, use_count: 1500 },
    { name: "grafana/mcp-grafana", description: "Grafana/Loki/k6 observabilidad MCP", url: null, repo: "https://github.com/grafana/mcp-grafana", registry: "curated", verified: true, use_count: 3500 },
    { name: "getsentry/sentry-mcp", description: "Sentry errores/monitorización MCP", url: "https://mcp.sentry.dev", repo: "https://github.com/getsentry/sentry-mcp", registry: "curated", verified: true, use_count: 855 },
    { name: "stripe/stripe-mcp", description: "Stripe payments MCP oficial", url: "https://mcp.stripe.com", repo: "https://github.com/stripe/ai", registry: "curated", verified: true, use_count: 1800 },
    { name: "makenotion/notion-mcp-server", description: "Notion oficial (remoto OAuth)", url: null, repo: "https://github.com/makenotion/notion-mcp-server", registry: "curated", verified: true, use_count: 4600 },
    { name: "atlassian/atlassian-mcp-server", description: "Jira/Confluence/JSM oficial (GA)", url: "https://mcp.atlassian.com/v2/mcp", repo: "https://github.com/atlassian/atlassian-mcp-server", registry: "curated", verified: true, use_count: 1000 },
    { name: "figma/mcp-server-guide", description: "Figma Dev Mode MCP (remoto + desktop)", url: "https://mcp.figma.com/mcp", repo: "https://github.com/figma/mcp-server-guide", registry: "curated", verified: true, use_count: 2000 },
    { name: "vercel/vercel-mcp", description: "Vercel MCP remoto oficial", url: "https://mcp.vercel.com", repo: "https://github.com/vercel/vercel-mcp-overview", registry: "curated", verified: true, use_count: 0 },
    { name: "perplexityai/modelcontextprotocol", description: "Perplexity Sonar MCP oficial", url: null, repo: "https://github.com/perplexityai/modelcontextprotocol", registry: "curated", verified: true, use_count: 2500 },
    { name: "groq/groq-mcp-server", description: "Groq API MCP oficial", url: null, repo: "https://github.com/groq/groq-mcp-server", registry: "curated", verified: true, use_count: 0 },
    { name: "exa-labs/exa-mcp-server", description: "Búsqueda web neural Exa", url: null, repo: "https://github.com/exa-labs/exa-mcp-server", registry: "curated", verified: true, use_count: 5000 },
    { name: "tavily-ai/tavily-mcp", description: "Tavily web search oficial", url: null, repo: "https://github.com/tavily-ai/tavily-mcp", registry: "curated", verified: true, use_count: 2400 },
    { name: "firecrawl/firecrawl-mcp-server", description: "Firecrawl scraping/crawl oficial", url: null, repo: "https://github.com/firecrawl/firecrawl-mcp-server", registry: "curated", verified: true, use_count: 7500 },
    { name: "apify/apify-mcp-server", description: "Apify actors como tools MCP", url: "https://mcp.apify.com", repo: "https://github.com/apify/apify-mcp-server", registry: "curated", verified: true, use_count: 7600 },
    { name: "resend/resend-mcp", description: "Resend email oficial", url: null, repo: "https://github.com/resend/resend-mcp", registry: "curated", verified: true, use_count: 571 },
    { name: "zapier/zapier-mcp", description: "Zapier MCP (9.000 apps)", url: "https://mcp.zapier.com/api/v1/connect", repo: "https://github.com/zapier/zapier-mcp", registry: "curated", verified: true, use_count: 410 },
    { name: "hashicorp/terraform-mcp-server", description: "Terraform Registry MCP oficial", url: null, repo: "https://github.com/hashicorp/terraform-mcp-server", registry: "curated", verified: true, use_count: 1500 },
    { name: "docker/mcp-gateway", description: "Catálogo/gateway de Docker Desktop", url: null, repo: "https://github.com/docker/mcp-gateway", registry: "curated", verified: true, use_count: 1600 },
    { name: "ibm/mcp-context-forge", description: "IBM ContextForge: gateway + registry MCP", url: null, repo: "https://github.com/IBM/mcp-context-forge", registry: "curated", verified: true, use_count: 4500 },
    { name: "openai/openai-apps-sdk-examples", description: "Apps de ChatGPT = servidores MCP (ejemplos oficiales)", url: null, repo: "https://github.com/openai/openai-apps-sdk-examples", registry: "curated", verified: true, use_count: 2300 },
    { name: "openai/tunnel-client", description: "Secure MCP Tunnel hacia ChatGPT/Codex", url: null, repo: "https://github.com/openai/tunnel-client", registry: "curated", verified: true, use_count: 0 },

    { name: "coleam00/mcp-crawl4ai-rag", description: "RAG con crawl4ai vía MCP (creación de RAG como servicio)", url: null, repo: "https://github.com/coleam00/mcp-crawl4ai-rag", registry: "curated", verified: true, use_count: 2200 },
    { name: "coleam00/mcp-mem0", description: "Memoria persistente para agentes vía MCP (mem0)", url: null, repo: "https://github.com/coleam00/mcp-mem0", registry: "curated", verified: true, use_count: 684 },
    { name: "coleam00/supabase-mcp", description: "Supabase tools como MCP (postgrest, funciones)", url: null, repo: "https://github.com/coleam00/supabase-mcp", registry: "curated", verified: true, use_count: 0 },
    { name: "coleam00/remote-mcp-server-with-auth", description: "Template MCP remoto con GitHub OAuth", url: null, repo: "https://github.com/coleam00/remote-mcp-server-with-auth", registry: "curated", verified: true, use_count: 0 },
    { name: "simonw/mcp-explorer", description: "Explorar servidores MCP desde CLI (Simon Willison)", url: null, repo: "https://github.com/simonw/mcp-explorer", registry: "curated", verified: true, use_count: 0 },
    { name: "simonw/llm-mcp-client", description: "Cliente MCP dentro del CLI `llm` de Simon Willison", url: null, repo: "https://github.com/simonw/llm-mcp-client", registry: "curated", verified: true, use_count: 0 },
    { name: "Doriandarko/sora-mcp", description: "MCP server para Sora (generación de vídeo) — Pietro Schirano", url: null, repo: "https://github.com/Doriandarko/sora-mcp", registry: "curated", verified: true, use_count: 0 },
    { name: "jherr/ts-mcp", description: "Demo: MCP server con TanStack Start (Jack Herrington)", url: null, repo: "https://github.com/jherr/ts-mcp", registry: "curated", verified: true, use_count: 0 },
    { name: "CodelyTV/typescript-mcp-client", description: "Cliente MCP tipado en TypeScript (curso CodelyTV)", url: null, repo: "https://github.com/CodelyTV/typescript-mcp-client", registry: "curated", verified: true, use_count: 0 },
  ];
}

export async function fetchSmitheryRegistry(): Promise<McpServerRow[]> {
  const out: McpServerRow[] = [];
  for (let page = 1; page <= 20 && out.length < MAX_ENTRIES; page++) {
    try {
      const data = JSON.parse(
        await fetchText(`https://registry.smithery.ai/servers?page=${page}&pageSize=100`, {
          timeoutMs: 30_000,
        }),
      ) as {
        servers?: {
          qualifiedName?: string;
          displayName?: string;
          description?: string;
          homepage?: string;
          remote?: boolean;
          useCount?: number;
          verified?: boolean;
        }[];
      };
      const list = data.servers ?? [];
      for (const s of list) {
        if (!s.qualifiedName) continue;
        out.push({
          name: `@${s.qualifiedName}`,
          description: s.description ?? s.displayName ?? null,
          url: null,
          repo: s.homepage ?? null,
          registry: "smithery",
          verified: s.verified ?? false,
          use_count: s.useCount ?? 0,
        });
      }
      if (list.length === 0) break;
    } catch {
      break;
    }
  }
  return out;
}
