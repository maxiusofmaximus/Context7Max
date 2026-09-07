import { countTokens, hashContent } from "@ctx7max/core";
import type { GuideRow } from "@ctx7max/core";
import { fetchGitHubZipFiles } from "./github.js";

export type GuideDraft = Omit<
  GuideRow,
  "id" | "tokens" | "content_hash" | "embedding"
>;

export type GuideSourceName =
  | "roadmap.sh"
  | "ossu"
  | "freecodecamp"
  | "odin"
  | "fullstackopen"
  | "missing-semester";

export const GUIDE_SOURCES: GuideSourceName[] = [
  "roadmap.sh",
  "ossu",
  "freecodecamp",
  "odin",
  "fullstackopen",
  "missing-semester",
];

const LICENSES: Record<GuideSourceName, string> = {
  "roadmap.sh": "custom-personal-reference (roadmap.sh © Kamran Ahmed)",
  ossu: "MIT",
  freecodecamp: "CC BY-NC-SA 4.0 (contenido) / BSD-3 (código)",
  odin: "CC BY-NC-SA 4.0 (The Odin Project, E. Trautman)",
  fullstackopen: "CC BY-NC-SA 3.0 (U. Helsinki)",
  "missing-semester": "CC BY-NC-SA 4.0 (MIT)",
};

// ── roadmap.sh — dominios canónicos ─────────────────────────────────

const ROADMAP_DOMAIN: Record<string, string> = {
  frontend: "frontend", react: "frontend", vue: "frontend", angular: "frontend",
  nextjs: "frontend", html: "frontend", css: "frontend", "design-system": "architecture",
  "ux-design": "frontend",
  backend: "backend", nodejs: "backend", "spring-boot": "backend",
  "aspnet-core": "backend", graphql: "backend", "api-design": "architecture",
  php: "languages", python: "languages", javascript: "languages",
  typescript: "languages", golang: "languages", rust: "languages",
  java: "languages", cpp: "languages", "kotlin": "languages", csharp: "languages",
  "full-stack": "fullstack",
  devops: "devops", docker: "devops", kubernetes: "devops", terraform: "devops",
  cicd: "devops", "git-github": "tools", linux: "linux-distros",
  aws: "cloud", cloudflare: "cloud",
  android: "android", ios: "ios", flutter: "mobile-multiplatform",
  "react-native": "mobile-multiplatform", "kotlin-multiplatform": "mobile-multiplatform",
  "game-developer": "gamedev", "game-design": "gamedev",
  "computer-science": "cs-fundamentals", "data-structures-and-algorithms": "cs-fundamentals",
  "datastructures-and-algorithms": "cs-fundamentals", "system-design": "architecture",
  "software-architect": "architecture", "software-design-architecture": "architecture",
  "ai-engineer": "ai-llm", "ai-agents": "ai-llm", "prompt-engineering": "ai-llm",
  llmops: "ai-llm", "machine-learning": "ai-llm", mlops: "ai-llm", "ai-data-scientist": "data",
  "data-engineer": "data", "data-analyst": "data", "sql": "databases",
  "postgresql-dba": "databases", mongodb: "databases", redis: "databases",
  "cyber-security": "security", "qa": "qa-testing", blockchain: "blockchain",
  "career-path": "career", "product-manager": "career", engineering: "career",
  "technical-writer": "career",
};

/** roadmap.sh: cada fichero roadmap/<slug>/content/<tema>@<nodeId>.md = 1 guía. */
export async function fetchRoadmapSh(token?: string): Promise<GuideDraft[]> {
  const files = await fetchGitHubZipFiles("nilbuild", "developer-roadmap", "master", token);
  const out: GuideDraft[] = [];
  for (const [path, bytes] of files) {
    const m = path.match(/^roadmaps\/([^/]+)\/content\/([^/]+)\.md$/);
    if (!m) continue;
    const [, slug, file] = m;
    const text = new TextDecoder().decode(bytes).trim();
    if (text.length < 40) continue;

    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.split("@")[0]!.replace(/[-_]+/g, " ");
    const body = text.replace(/^#\s+.+$/m, "").trim();
    const links: GuideDraft["links"] = [];
    const linkRe = /\[(?:@([a-z-]+)@)?([^\]]+)\]\(([^)]+)\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(body)) !== null) {
      links.push({ type: lm[1] ?? "link", label: lm[2]!, url: lm[3]! });
    }
    const nodeMatch = file.match(/@([\w-]+)$/);
    out.push({
      source: "roadmap.sh",
      domain: ROADMAP_DOMAIN[slug!] ?? slug!,
      track: slug!,
      node_id: nodeMatch?.[1] ?? null,
      title,
      body,
      links,
      position: 0,
      license: LICENSES["roadmap.sh"],
    });
  }
  return out;
}

// ── OSSU computer-science: README tablas de cursos ──────────────────

export async function fetchOssu(token?: string): Promise<GuideDraft[]> {
  const files = await fetchGitHubZipFiles("ossu", "computer-science", "master", token);
  const readme = files.get("README.md");
  if (!readme) return [];
  const text = new TextDecoder().decode(readme);
  const out: GuideDraft[] = [];

  let track = "general";
  let position = 0;
  for (const line of text.split("\n")) {
    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      track = h[2]!.trim();
      continue;
    }
    // | [Course](url) | duration | effort | prereq |  — some rows lack the leading |
    const row = line.match(/^\|?\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.+?)\|?\s*$/);
    if (row) {
      const cells = row[3]!.split("|").map((c) => c.trim());
      const [, name, rawUrl] = row;
      const url = /^https?:/.test(rawUrl!)
        ? rawUrl!
        : `https://github.com/ossu/computer-science/blob/master/${rawUrl!.replace(/^\.\//, "")}`;
      out.push({
        source: "ossu",
        domain: "cs-fundamentals",
        track,
        node_id: null,
        title: name!,
        body: [
          `Curso recomendado OSSU: **${name}** (${url})`,
          cells[0] ? `Duración: ${cells[0]}` : "",
          cells[1] ? `Esfuerzo: ${cells[1]}` : "",
          cells[2] ? `Prerrequisitos: ${cells[2]}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        links: [{ type: "course", label: name!, url }],
        position: position++,
        license: LICENSES.ossu,
      });
    }
  }
  return out;
}

// ── freeCodeCamp (estructura + challenges md) ───────────────────────

const FCC_DOMAIN: Record<string, string> = {
  javascript: "languages", python: "languages", "legacy-" : "web",
  "responsive-web-design": "frontend", "front-end": "frontend",
  "javascript-algorithms": "cs-fundamentals", react: "frontend",
  redux: "frontend", "data-visualization": "data", apis: "backend",
  "information-security": "security", "quality-assurance": "qa-testing",
  "back-end": "backend", "relational-database": "databases",
  "machine-learning": "ai-llm", "data-analysis": "data",
};

export async function fetchFreeCodeCamp(token?: string): Promise<GuideDraft[]> {
  // challenges viven en curriculum/challenges/english/<track>/<block>/*.md
  const files = await fetchGitHubZipFiles("freeCodeCamp", "freeCodeCamp", "main", token);
  const out: GuideDraft[] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith("curriculum/challenges/english/")) continue;
    if (!path.endsWith(".md")) continue;
    const parts = path.split("/");
    const rawTrack = parts[3] ?? "general";
    const track = rawTrack.replace(/^\d+-/, "");
    if (out.length >= 2500) break;
    const text = new TextDecoder().decode(bytes);
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (!title) continue;
    const body = text
      .replace(/^---[\s\S]*?---/m, "")
      .replace(/^#\s+.+$/m, "")
      .trim();
    if (body.length < 120) continue;
    const domain =
      Object.entries(FCC_DOMAIN).find(([k]) => track.toLowerCase().includes(k))?.[1] ??
      "frontend";
    out.push({
      source: "freecodecamp",
      domain,
      track,
      node_id: parts[parts.length - 1]!.replace(/\.md$/, ""),
      title,
      body,
      links: [],
      position: 0,
      license: LICENSES.freecodecamp,
    });
  }
  return out;
}

// ── The Odin Project: lecciones .md por curso ───────────────────────

const ODIN_DOMAIN: Record<string, string> = {
  foundations: "frontend", git: "tools", intermediate_html_css: "frontend",
  advanced_html_css: "frontend", javascript: "frontend", react: "frontend",
  nodeJS: "backend", databases: "databases", ruby: "languages",
  ruby_on_rails: "backend", getting_hired: "career", shared: "career",
};

export async function fetchOdin(token?: string): Promise<GuideDraft[]> {
  const files = await fetchGitHubZipFiles("TheOdinProject", "curriculum", "main", token);
  const out: GuideDraft[] = [];
  for (const [path, bytes] of files) {
    if (!path.endsWith(".md")) continue;
    const parts = path.split("/");
    const courseDir = parts[0] ?? "";
    if (!ODIN_DOMAIN[courseDir] && !courseDir.includes) continue;
    const text = new TextDecoder().decode(bytes);
    if (text.length < 200) continue;
    const title =
      text.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      parts[parts.length - 1]!.replace(/\.md$/, "").replace(/[-_]+/g, " ");
    out.push({
      source: "odin",
      domain: ODIN_DOMAIN[courseDir] ?? "fullstack",
      track: courseDir,
      node_id: path.replace(/\.md$/, ""),
      title,
      body: text.replace(/^#\s+.+$/m, "").trim(),
      links: [],
      position: 0,
      license: LICENSES.odin,
    });
  }
  return out;
}

// ── Full Stack Open (U. Helsinki) — src/content/<part>/<lang>/partX.md ──

export async function fetchFullStackOpen(token?: string): Promise<GuideDraft[]> {
  const files = await fetchGitHubZipFiles(
    "fullstack-hy2020",
    "fullstack-hy2020.github.io",
    "source",
    token,
  );
  const out: GuideDraft[] = [];
  for (const [path, bytes] of files) {
    const m = path.match(/^src\/content\/(\d+)\/(en)\/([^/]+)\.md$/);
    if (!m) continue;
    const [, part, , file] = m;
    const text = new TextDecoder().decode(bytes).trim();
    if (text.length < 200) continue;
    out.push({
      source: "fullstackopen",
      domain: "fullstack",
      track: `part-${part}`,
      node_id: file!.replace(/\.md$/, ""),
      title: `Full Stack Open — Parte ${part} (${file})`,
      body: text
        .replace(/^---[\s\S]*?---/m, "")
        .replace(/^#\s+.+$/m, "")
        .trim(),
      links: [],
      position: parseInt(part!, 10) ?? 0,
      license: LICENSES.fullstackopen,
    });
  }
  return out;
}

// ── MIT Missing Semester ────────────────────────────────────────────

export async function fetchMissingSemester(token?: string): Promise<GuideDraft[]> {
  const files = await fetchGitHubZipFiles("missing-semester", "missing-semester", "master", token);
  const out: GuideDraft[] = [];
  for (const [path, bytes] of files) {
    const m = path.match(/^_(\d{4})\/([^/]+)\.md$/);
    if (!m) continue;
    const [, year, file] = m;
    if (file === "index") continue;
    const text = new TextDecoder().decode(bytes);
    const title =
      text.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1]?.trim() ??
      file!.replace(/[-_]+/g, " ");
    const body = text.replace(/^---[\s\S]*?---/m, "").trim();
    if (body.length < 200) continue;
    out.push({
      source: "missing-semester",
      domain: "tools",
      track: `edition-${year}`,
      node_id: `${year}/${file}`,
      title,
      body,
      links: [],
      position: 0,
      license: LICENSES["missing-semester"],
    });
  }
  return out;
}

export const GUIDE_FETCHERS: Record<GuideSourceName, (token?: string) => Promise<GuideDraft[]>> = {
  "roadmap.sh": fetchRoadmapSh,
  ossu: fetchOssu,
  freecodecamp: fetchFreeCodeCamp,
  odin: fetchOdin,
  fullstackopen: fetchFullStackOpen,
  "missing-semester": fetchMissingSemester,
};
