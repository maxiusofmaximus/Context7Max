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
