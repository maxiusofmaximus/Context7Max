import pc from "picocolors";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { wrapCmd } from "./library.js";

function apiBase(): string {
  const cfg = loadConfig();
  if (!cfg.apiUrl || !cfg.apiKey) {
    throw new Error("Configura api-url + api-key: ctx7max config --api-url <…> --api-key <…>");
  }
  return cfg.apiUrl.replace(/\/+$/, "");
}

async function apiGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const cfg = loadConfig();
  const url = new URL(`${apiBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return data;
}

// ── guides ──────────────────────────────────────────────────────────

interface GuideHit {
  source: string;
  domain: string;
  track: string | null;
  title: string;
  body: string;
  links: { type: string; label: string; url: string }[];
  license: string | null;
  score: number;
}

export const cmdGuide = wrapCmd(
  async (query: string, opts: { domain?: string; limit?: number; json?: boolean }) => {
    const params: Record<string, string> = { query };
    if (opts.domain) params.domain = opts.domain;
    if (opts.limit) params.limit = String(opts.limit);
    const data = (await apiGet("/api/v2/guides", params)) as {
      results: GuideHit[];
      mode: string;
    };
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.results.length === 0) {
      console.log(pc.yellow(`Sin guías para "${query}"${opts.domain ? ` en ${opts.domain}` : ""}.`));
      console.log(pc.dim(`Indexa con: ctx7max ingest guides`));
      return;
    }
    console.log(
      pc.bold(`\n${data.results.length} guía(s)`) +
        pc.dim(` (${data.mode})${opts.domain ? ` · dominio: ${opts.domain}` : ""}\n`),
    );
    for (const g of data.results) {
      console.log(pc.cyan(`■ ${g.title}`) + pc.dim(`  [${g.domain}${g.track ? " / " + g.track : ""} · ${g.source}]`));
      console.log(`  ${g.body.slice(0, 320).replace(/\n+/g, " ")}${g.body.length > 320 ? "…" : ""}`);
      if (g.links.length) {
        for (const l of g.links.slice(0, 3)) {
          console.log(pc.dim(`  ↳ [${l.type}] ${l.url}`));
        }
      }
      console.log();
    }
  },
);

export const cmdGuides = wrapCmd(async (opts: { json?: boolean }) => {
  const data = (await apiGet("/api/v2/guides")) as {
    domains: Record<string, { sources: string[]; guides: number }>;
  };
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const entries = Object.entries(data.domains).sort((a, b) => b[1].guides - a[1].guides);
  console.log(pc.bold(`\n${entries.length} dominios de conocimiento:\n`));
  for (const [domain, info] of entries) {
    console.log(
      `${pc.cyan(domain.padEnd(24))} ${String(info.guides).padStart(5)} guías  ${pc.dim(info.sources.join(", "))}`,
    );
  }
});

// ── skills ──────────────────────────────────────────────────────────

interface SkillHit {
  id: string;
  name: string;
  description: string | null;
  source: string;
  repo_url: string | null;
  installs: number;
  score: number;
}

export const cmdSkillSearch = wrapCmd(
  async (query: string, opts: { limit?: number; json?: boolean }) => {
    const data = (await apiGet("/api/v2/skills", {
      q: query,
      limit: String(opts.limit ?? 15),
    })) as { results: SkillHit[]; mode: string };
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.results.length === 0) {
      console.log(pc.yellow(`Sin skills para "${query}".`));
      return;
    }
    console.log(pc.bold(`\n${data.results.length} skills:\n`));
    for (const s of data.results) {
      console.log(
        `${pc.cyan(s.name)}  ${pc.dim(`[${s.source} score ${s.score.toFixed(2)}]`)}`,
      );
      if (s.description) console.log(pc.dim(`  ${s.description.slice(0, 140)}`));
      console.log(pc.dim(`  instalar: ctx7max skill install "${s.id}"`));
      console.log();
    }
  },
);

export const cmdSkillInstall = wrapCmd(async (id: string) => {
  const skill = (await apiGet("/api/v2/skills", { id })) as {
    id: string;
    name: string;
    body: string;
    frontmatter: Record<string, unknown>;
    description: string | null;
  };

  // reconstruye un SKILL.md canónico (frontmatter + cuerpo)
  const fm: Record<string, unknown> = { name: skill.name, ...skill.frontmatter };
  if (skill.description && !fm.description) fm.description = skill.description;
  const fmLines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${String(v).split("\n")[0]}`)
    .join("\n");
  const skillMd = `---\n${fmLines}\n---\n\n${skill.body}\n`;

  const targets = [
    join(homedir(), ".agents", "skills", skill.name),
    join(homedir(), ".config", "opencode", "skills", skill.name),
  ];
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), skillMd, "utf8");
    console.log(pc.green(`✓ instalada en ${dir}/SKILL.md`));
  }
});

// ── mcps ────────────────────────────────────────────────────────────

export const cmdMcps = wrapCmd(async (query: string) => {
  const data = (await apiGet("/api/v2/mcps", { q: query })) as {
    results: {
      name: string;
      description: string | null;
      url: string | null;
      repo: string | null;
      registry: string;
      verified: boolean;
      use_count: number;
    }[];
  };
  if (data.results.length === 0) {
    console.log(pc.yellow(`Sin servidores MCP para "${query}". Indexa: ctx7max ingest mcps`));
    return;
  }
  console.log(pc.bold(`\n${data.results.length} servidores MCP:\n`));
  for (const s of data.results) {
    const badge = s.verified ? pc.green("✓") : " ";
    console.log(`${badge} ${pc.cyan(s.name)} ${pc.dim(`[${s.registry} · ${s.use_count} usos]`)}`);
    if (s.description) console.log(pc.dim(`  ${s.description.slice(0, 130)}`));
    if (s.repo) console.log(pc.dim(`  ${s.repo}`));
    console.log();
  }
});

// ── ingest (admin, local) ───────────────────────────────────────────

export const cmdIngest = wrapCmd(
  async (what: string, opts: { source?: string; noEmbed?: boolean }) => {
    const cfg = loadConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
      throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ctx7max config)");
    }
    const env = {
      supabaseUrl: cfg.supabaseUrl,
      serviceRoleKey: cfg.supabaseServiceRoleKey,
    };
    const { ingestGuides, ingestSkills, ingestMcpServers, GUIDE_SOURCES } =
      await import("@ctx7max/ingestor");
    const log = (m: string) => console.log(pc.dim(m));
    const common = {
      env,
      embed: !opts.noEmbed,
      githubToken: cfg.githubToken,
      onLog: log,
    };

    if (what === "guides") {
      const sources = opts.source
        ? [opts.source as (typeof GUIDE_SOURCES)[number]]
        : [...GUIDE_SOURCES];
      for (const s of sources) {
        console.log(pc.bold(`\nIngestando guías: ${s}`));
        const r = await ingestGuides(s, common);
        console.log(pc.green(`  ✓ ${r.guides} guías (${r.tokens.toLocaleString()} tokens)`));
      }
      return;
    }
    if (what === "skills") {
      console.log(pc.bold("\nIngestando skills…"));
      const r = await ingestSkills(common);
      console.log(pc.green(`  ✓ ${r.total} skills indexadas`));
      return;
    }
    if (what === "mcps") {
      console.log(pc.bold("\nIngestando servidores MCP…"));
      const r = await ingestMcpServers(common);
      console.log(pc.green(`  ✓ ${r.total} servidores`));
      return;
    }
    throw new Error(`ingest: tipo desconocido "${what}". Usa guides|skills|mcps`);
  },
);
