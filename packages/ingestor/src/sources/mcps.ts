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
