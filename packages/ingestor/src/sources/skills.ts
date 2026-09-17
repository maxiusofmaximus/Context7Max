import { countTokens, hashContent } from "@ctx7max/core";
import type { SkillRow } from "@ctx7max/core";
import { fetchText, pool } from "../util.js";
import { fetchGitHubZipFiles } from "./github.js";

type SkillDraft = Omit<SkillRow, "tokens" | "content_hash" | "embedding">;

const SKILL_REPOS: { owner: string; repo: string; globHint: string }[] = [
  // originales
  { owner: "anthropics", repo: "skills", globHint: "skills/" },
  { owner: "mattpocock", repo: "skills", globHint: "skills/" },
  { owner: "antfu", repo: "skills", globHint: "skills/" },
  { owner: "obra", repo: "superpowers", globHint: "" },
  { owner: "vercel-labs", repo: "agent-skills", globHint: "" },
  { owner: "vercel-labs", repo: "skills", globHint: "" },
  { owner: "addyosmani", repo: "agent-skills", globHint: "" },
  { owner: "supabase", repo: "agent-skills", globHint: "" },
  // ── proveedores cloud / plataformas (oficiales) ──
  { owner: "cloudflare", repo: "skills", globHint: "skills/" },
  { owner: "google", repo: "agents-cli", globHint: "skills/" },
  { owner: "google-gemini", repo: "gemini-skills", globHint: "" },
  { owner: "firebase", repo: "agent-skills", globHint: "" },
  { owner: "aws", repo: "agent-toolkit-for-aws", globHint: "" },
  { owner: "awslabs", repo: "agent-plugins", globHint: "" },
  { owner: "microsoft", repo: "azure-skills", globHint: "" },
  { owner: "neondatabase", repo: "agent-skills", globHint: "" },
  { owner: "auth0", repo: "agent-skills", globHint: "" },
  { owner: "clerk", repo: "skills", globHint: "" },
  { owner: "resend", repo: "resend-skills", globHint: "" },
  { owner: "stripe", repo: "ai", globHint: "" },
  { owner: "prisma", repo: "skills", globHint: "" },
  { owner: "hashicorp", repo: "agent-skills", globHint: "" },
  { owner: "langchain-ai", repo: "langchain-skills", globHint: "" },
  { owner: "expo", repo: "skills", globHint: "" },
  { owner: "github", repo: "awesome-copilot", globHint: "" },
  { owner: "openai", repo: "skills", globHint: "" },
  // ── ciberseguridad ──
  { owner: "mukul975", repo: "Anthropic-Cybersecurity-Skills", globHint: "" },
  { owner: "Masriyan", repo: "Claude-Code-CyberSecurity-Skill", globHint: "" },
  { owner: "transilienceai", repo: "communitytools", globHint: "" },
  { owner: "26zl", repo: "cybersec-toolkit", globHint: "" },
  { owner: "elementalsouls", repo: "Claude-OSINT", globHint: "" },
  { owner: "gadievron", repo: "raptor", globHint: "" },
  { owner: "cloudflare", repo: "security-audit-skill", globHint: "" },
  // ── ciencia/varios top del leaderboard ──
  { owner: "K-Dense-AI", repo: "scientific-agent-skills", globHint: "" },
  { owner: "emilkowalski", repo: "skills", globHint: "" },
  { owner: "coreyhaines31", repo: "marketingskills", globHint: "" },
  // ── creadores de contenido (verificados sep-2026) ──
  { owner: "midudev", repo: "autoskills", globHint: "registry/" },
  { owner: "ArisGuimera", repo: "MobiAI-Core", globHint: "skills/" },
  { owner: "goncy", repo: "skills", globHint: "" },
  { owner: "Klerith", repo: "fernando-skills", globHint: "skills/" },
  { owner: "ThePrimeagen", repo: "skills", globHint: "skills/" },
  { owner: "bradtraversy", repo: "coding-with-ai-course-resources", globHint: "skills/" },
  { owner: "DavidOndrej", repo: "skills", globHint: "skills/" },
  { owner: "coleam00", repo: "skills", globHint: "" },
  { owner: "coleam00", repo: "excalidraw-diagram-skill", globHint: "" },
  { owner: "coleam00", repo: "second-brain-skills", globHint: "" },
  { owner: "Doriandarko", repo: "skirano-skills", globHint: "skills/" },
  { owner: "simonw", repo: "skills", globHint: "skills/" },
];

/** Frontmatter YAML plano (name/description/licenses) — no full YAML parser. */
function parseFrontmatter(text: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text };
  const flat = m[1]!;
  const fm: Record<string, unknown> = {};
  for (const line of flat.split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return { frontmatter: fm, body: m[2]!.trim() };
}

function capBody(body: string): string {
  // spec recommends <500 lines — cap harder to keep storage small
  return body.slice(0, 60_000);
}

/** ui-skills.com registry: plain TSV — the easiest source imaginable. */
export async function fetchUiSkills(): Promise<SkillDraft[]> {
  const registry = await fetchText("https://ui-skills.com/skills/registry.txt", {
    timeoutMs: 30_000,
  });
  const lines = registry.split("\n").map((l) => l.trim()).filter(Boolean);
  const drafts: SkillDraft[] = [];
  await pool(lines.slice(0, 400), 6, async (line) => {
    const [id, rawUrl, ...descParts] = line.split("\t");
    if (!id || !rawUrl) return null;
    try {
      const raw = await fetchText(rawUrl, { timeoutMs: 30_000 });
      const { frontmatter, body } = parseFrontmatter(raw);
      const name = (frontmatter.name as string) ?? id.split("/").pop()!;
      drafts.push({
        id: `uiskills:${id.replace(/\//g, "--")}`,
        source: "ui-skills",
        name,
        description:
          (frontmatter.description as string) ?? (descParts.join(" ").trim() || null),
        repo_url: null,
        raw_url: rawUrl,
        body: capBody(body),
        frontmatter,
        files: [],
        license: (frontmatter.license as string) ?? null,
        installs: 0,
        trust: {},
      });
    } catch {
      /* ficha rota — skip */
    }
    return null;
  });
  return drafts;
}

/** GitHub repos that follow the skills/<name>/SKILL.md layout. */
export async function fetchGitHubSkillRepos(token?: string): Promise<SkillDraft[]> {
  const drafts: SkillDraft[] = [];
  for (const repo of SKILL_REPOS) {
    let files: Map<string, Uint8Array>;
    try {
      files = await fetchGitHubZipFiles(repo.owner, repo.repo, "main", token).catch(() =>
        fetchGitHubZipFiles(repo.owner, repo.repo, "master", token),
      );
    } catch {
      continue; // repo desaparecido/privado — skip
    }
    for (const [path, bytes] of files) {
      if (!/\/SKILL\.md$/i.test(path) && !/^SKILL\.md$/i.test(path)) continue;
      const raw = new TextDecoder().decode(bytes);
      const { frontmatter, body } = parseFrontmatter(raw);
      const skillName =
        (frontmatter.name as string) ??
        path.split("/").slice(-2, -1)[0] ??
        path.replace(/\.md$/i, "");
      drafts.push({
        id: `github:${repo.owner}/${repo.repo}/${path}#${skillName}`,
        source: "github",
        name: skillName,
        description: (frontmatter.description as string) ?? null,
        repo_url: `https://github.com/${repo.owner}/${repo.repo}`,
        raw_url: `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`,
        body: capBody(body),
        frontmatter,
        files: [],
        license: (frontmatter.license as string) ?? null,
        installs: 0,
        trust: {},
      });
    }
  }
  return drafts;
}

/** skills.sh public leaderboard API (best-effort; needs no key for basic read) */
export async function fetchSkillsSh(): Promise<SkillDraft[]> {
  const drafts: SkillDraft[] = [];
  let page = 1;
  for (; page <= 6; page++) {
    try {
      const res = await fetchText(
        `https://skills.sh/api/v1/skills?view=all&page=${page}&per_page=100`,
        { timeoutMs: 30_000 },
      );
      const data = JSON.parse(res) as {
        skills?: {
          id?: string;
          source?: string;
          skill?: string;
          name?: string;
          description?: string;
          installs?: number;
        }[];
      };
      const list = data.skills ?? [];
      if (list.length === 0) break;
      for (const s of list) {
        const ownerRepo = s.source ?? s.id ?? "";
        drafts.push({
          id: `skillssh:${ownerRepo.replace(/\//g, "--")}--${s.skill ?? s.name ?? ""}`,
          source: "skills.sh",
          name: s.skill ?? s.name ?? ownerRepo,
          description: s.description ?? null,
          repo_url: ownerRepo.startsWith("http") ? null : `https://github.com/${ownerRepo}`,
          raw_url: null,
          body: s.description ?? "",
          frontmatter: {},
          files: [],
          license: null,
          installs: s.installs ?? 0,
          trust: {},
        });
      }
      if (list.length < 100) break;
    } catch {
      break; // API requiere auth o rate-limited — parar limpio
    }
  }
  // a partir de aquí solo guardamos equivalentes con contenido propio;
  // para no inflar con filas sin cuerpo, sólo conservamos las conocidas.
  return drafts.filter((d) => d.body.length > 40);
}

export function toSkillRow(d: SkillDraft): SkillRow {
  const tokens = countTokens(d.description ?? "") + countTokens(d.body);
  const content_hash = hashContent(d.body);
  return { ...d, tokens, content_hash };
}
