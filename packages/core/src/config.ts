import { z } from "zod";
import micromatch from "micromatch";

/**
 * context7max.json — superset of Context7's context7.json.
 * A repository can commit either file; context7max.json wins when both exist.
 */
export const Context7MaxConfigSchema = z.object({
  $schema: z.string().optional(),
  projectTitle: z.string().optional(),
  description: z.string().optional(),
  branch: z.string().optional(),
  folders: z.array(z.string()).default([]),
  excludeFolders: z.array(z.string()).default([]),
  excludeFiles: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  previousVersions: z
    .array(z.object({ tag: z.string() }))
    .default([]),
  branchVersions: z
    .array(z.object({ branch: z.string() }))
    .default([]),
  // ── Context7Max extensions ──
  /** Max snippets stored per version (quality-ranked). 0 = unlimited. */
  maxSnippets: z.number().int().nonnegative().default(2000),
  /** Extra repos/URLs whose docs are merged into this library. */
  externalSources: z
    .array(
      z.object({
        type: z.enum(["github", "llmstxt", "website", "openapi"]),
        url: z.string(),
      }),
    )
    .default([]),
  /** Also index code examples from examples/, test files, etc. */
  includeExamples: z.boolean().default(true),
  /** Pin trust score 0-10 (owner-claimed libraries). */
  trustScore: z.number().min(0).max(10).optional(),
});

export type Context7MaxConfig = z.infer<typeof Context7MaxConfigSchema>;

export const DEFAULT_CONFIG: Context7MaxConfig =
  Context7MaxConfigSchema.parse({});

/** Parse raw JSON (unknown) into a validated config with defaults. */
export function parseLibraryConfig(raw: unknown): Context7MaxConfig {
  if (raw == null || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const res = Context7MaxConfigSchema.safeParse(raw);
  return res.success ? res.data : { ...DEFAULT_CONFIG };
}

// ── Document extensions we parse ────────────────────────────────────

export const DOC_EXTENSIONS = [
  ".md",
  ".mdx",
  ".markdown",
  ".mdown",
  ".mkdn",
  ".rst",
  ".txt",
  ".ipynb",
] as const;

// ── Default exclusions (mirrors Context7 published defaults) ────────

export const DEFAULT_EXCLUDED_FILES = [
  "changelog.md",
  "changelog.mdx",
  "license.md",
  "license",
  "licence.md",
  "code_of_conduct.md",
  "contributing.md",
  "security.md",
  "claude.md",
  "agents.md", // agent instructions, not library docs
  "pull_request_template.md",
  "robots.txt",
];

/** Translated README duplicates and similar — glob patterns on file name. */
export const DEFAULT_EXCLUDED_FILE_GLOBS = [
  "README_??.md",
  "README_???.md",
  "README_??.mdx",
  "README_???.mdx",
];

export const DEFAULT_EXCLUDED_FOLDERS = [
  "*archive*",
  "*archived*",
  "old",
  "docs/old",
  "*deprecated*",
  "*legacy*",
  "*previous*",
  "*outdated*",
  "*superseded*",
  "i18n/zh*",
  "i18n/es*",
  "i18n/fr*",
  "i18n/de*",
  "i18n/ja*",
  "i18n/ko*",
  "i18n/ru*",
  "i18n/pt*",
  "i18n/it*",
  "i18n/ar*",
  "i18n/hi*",
  "i18n/tr*",
  "i18n/nl*",
  "i18n/pl*",
  "i18n/sv*",
  "i18n/vi*",
  "i18n/th*",
  "zh-cn",
  "zh-tw",
  "zh-hk",
  "zh-mo",
  "zh-sg",
];

/**
 * Non-doc noise we never index even if it matches an extension —
 * curated after gitingest's DEFAULT_IGNORE_PATTERNS.
 */
export const NOISE_PATTERNS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".docusaurus",
  ".git",
  ".github",
  ".vscode",
  ".idea",
  "coverage",
  ".cache",
  "tmp",
  "temp",
  "__pycache__",
  ".venv",
  "venv",
  "site-packages",
  "fixtures",
  "__fixtures__",
  "testdata",
  "bench",
  "benchmarks",
  "scripts",
  "blog",
  "blogs",
  "*.min.*",
  "*.map",
  ".changeset",
  // agent-specific internal dirs — not library documentation
  ".claude",
  ".agents",
  ".cursor",
  ".gemini",
  ".codeium",
  ".windsurf",
  ".roo",
  ".opencode",
  "skills",
];

/** Folders whose code files may be indexed when includeExamples is on. */
export const EXAMPLE_FOLDER_HINTS = [
  "example",
  "examples",
  "sample",
  "samples",
  "demo",
  "demos",
  "cookbook",
  "recipes",
  "playground",
];

export const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".swift",
  ".sql",
  ".sh",
  ".bash",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
] as const;

// ── Path filtering ──────────────────────────────────────────────────

function splitPath(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function folderPatternsMatch(patterns: string[], path: string): boolean {
  const parts = splitPath(path);
  // check each ancestor folder segment and cumulative paths
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i - 1] ?? "";
    const prefix = parts.slice(0, i).join("/");
    for (const pat of patterns) {
      const p = pat.replace(/^\.\//, "");
      if (p.includes("*")) {
        if (micromatch.isMatch(prefix, p, { dot: true })) return true;
        if (micromatch.isMatch(segment, p)) return true;
      } else {
        if (segment === p || prefix === p) return true;
      }
    }
  }
  return false;
}

export interface FilterOptions {
  folders: string[];
  excludeFolders: string[];
  excludeFiles: string[];
  /** include root-level markdown even when folders is non-empty (Context7 semantics) */
  alwaysIncludeRootMarkdown?: boolean;
}

export function shouldIncludePath(
  path: string,
  opts: FilterOptions,
): boolean {
  const fileName = path.split("/").pop() ?? path;
  const lowerName = fileName.toLowerCase();
  const segs = splitPath(path);
  const isRoot = segs.length === 1;

  // 1. hard noise exclusion
  if (folderPatternsMatch(NOISE_PATTERNS, path)) return false;

  // 2. default excluded files / file globs
  if (DEFAULT_EXCLUDED_FILES.includes(lowerName)) return false;
  if (DEFAULT_EXCLUDED_FILE_GLOBS.some((g) => micromatch.isMatch(fileName, g)))
    return false;

  // 3. user excluded files (match by file name or glob)
  for (const pat of opts.excludeFiles) {
    if (pat.includes("*")) {
      if (micromatch.isMatch(fileName, pat) || micromatch.isMatch(path, pat))
        return false;
    } else if (fileName === pat || lowerName === pat.toLowerCase()) {
      return false;
    }
  }

  // 4. excluded folders always win (Context7 semantics)
  if (
    folderPatternsMatch(opts.excludeFolders, path) ||
    folderPatternsMatch(DEFAULT_EXCLUDED_FOLDERS, path)
  ) {
    return false;
  }

  // 5. folders whitelist (root markdown always included)
  if (opts.folders.length > 0) {
    if (isRoot && DOC_EXTENSIONS.some((e) => lowerName.endsWith(e)))
      return true; // root docs always in
    const inFolder = opts.folders.some((f) => {
      const fNorm = f.replace(/^\.\//, "").replace(/\/+$/, "");
      return path.startsWith(fNorm + "/") || path === fNorm;
    });
    if (!inFolder) return false;
  }

  return true;
}
