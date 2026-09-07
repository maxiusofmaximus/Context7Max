/**
 * Context7Max — core shared types.
 * The public API shapes are 1:1 compatible with Context7 v2 so existing
 * tooling (ctx7 clients, MCP clients) can be pointed at Context7Max.
 */

// ── Sources ─────────────────────────────────────────────────────────

export type SourceType = "github" | "llmstxt" | "website" | "openapi";

export type LibraryState =
  | "initial"
  | "queued"
  | "parsing"
  | "embedding"
  | "finalized"
  | "error";

// ── Database rows ───────────────────────────────────────────────────

export interface CatalogRow {
  id: string; // "/org/project"
  title: string;
  description: string | null;
  source_type: SourceType;
  source_url: string;
  tags: string[];
  stars: number;
  trust_score: number;
  created_at?: string;
}

export interface LibraryRow {
  id: string; // "/org/project"
  title: string;
  description: string | null;
  source_type: SourceType;
  source_url: string;
  branch: string | null;
  repo_sha: string | null;
  license: string | null;
  stars: number;
  trust_score: number; // 0..10
  state: LibraryState;
  state_message: string | null;
  total_tokens: number;
  total_snippets: number;
  versions: string[]; // e.g. ["v1.2.3"]
  rules: string[]; // sanitized, informational only
  settings: Record<string, unknown>; // resolved context7max.json
  quality: Record<string, unknown>; // coverage metrics
  last_update_at?: string;
  created_at?: string;
}

export interface CodeSnippetRow {
  id?: string;
  library_id: string;
  version: string; // resolved tag or "main"
  title: string;
  description: string | null;
  language: string | null;
  code: string;
  tokens: number;
  source_url: string | null;
  source_file: string | null;
  line_start: number | null;
  line_end: number | null;
  breadcrumb: string | null;
  content_hash: string;
  embedding?: number[] | null;
}

export interface InfoSnippetRow {
  id?: string;
  library_id: string;
  version: string;
  page_title: string | null;
  breadcrumb: string | null;
  content: string;
  tokens: number;
  source_url: string | null;
  source_file: string | null;
  content_hash: string;
  embedding?: number[] | null;
}

export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface JobRow {
  id?: string;
  library_id: string;
  action: "ingest" | "refresh" | "remove";
  status: JobStatus;
  stage: string | null;
  message: string | null;
  stats: Record<string, unknown>;
  actor: "cli" | "action" | "api" | "cron";
  created_at?: string;
  updated_at?: string;
}

// ── API shapes (Context7-compatible) ────────────────────────────────

export interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: LibraryState;
  totalTokens: number;
  totalSnippets: number;
  stars: number;
  trustScore: number;
  benchmarkScore: number;
  versions: string[];
  /** true when the entry comes from the catalog and is not indexed yet */
  indexed: boolean;
}

export interface ApiSearchResponse {
  results: ApiSearchResult[];
  searchFilterApplied: boolean;
}

export interface ApiCodeExample {
  language: string;
  code: string;
}

export interface ApiCodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeTokens: number;
  codeId: string;
  pageTitle: string;
  codeList: ApiCodeExample[];
}

export interface ApiInfoSnippet {
  pageId: string;
  breadcrumb: string;
  content: string;
  contentTokens: number;
}

export interface ApiContextResponse {
  codeSnippets: ApiCodeSnippet[];
  infoSnippets: ApiInfoSnippet[];
  rules: {
    global: string[];
    libraryOwn: string[];
    libraryTeam: string[];
  };
  meta?: {
    libraryId: string;
    version: string;
    query: string;
    mode: "hybrid" | "fts";
    returnedTokens: number;
    maxTokens: number;
    stale: boolean;
    lastIndexedAt: string | null;
  };
}

export interface ApiError {
  error: string;
  message: string;
}

// ── Ingestion drafts (pre-DB) ───────────────────────────────────────

export interface DocFile {
  /** repo-relative or site-relative path: docs/guide.md */
  path: string;
  /** raw textual content */
  content: string;
  /** canonical URL to the source (blob URL or page URL) if known */
  sourceUrl?: string;
}

export interface ParsedPage {
  path: string;
  title: string;
  sourceUrl: string | null;
  codeSnippets: Omit<
    CodeSnippetRow,
    "id" | "library_id" | "version" | "embedding"
  >[];
  infoSnippets: Omit<
    InfoSnippetRow,
    "id" | "library_id" | "version" | "embedding"
  >[];
}

export interface IngestSourceResult {
  libraryId: string;
  title: string;
  description: string | null;
  sourceType: SourceType;
  sourceUrl: string;
  branch: string | null;
  repoSha: string | null;
  license: string | null;
  stars: number;
  versions: string[];
  files: DocFile[];
  rules: string[];
  settings: Record<string, unknown>;
}

// ── Search / context params ─────────────────────────────────────────

export interface SearchParams {
  libraryName: string;
  query?: string;
  fast?: boolean;
  limit?: number;
}

export interface ContextParams {
  libraryId: string; // with optional /version or @version suffix
  query: string;
  fast?: boolean;
  maxTokens?: number;
  type?: "json" | "txt";
}

export const DEFAULT_MAX_TOKENS = 4000;
export const EMBEDDING_DIMS = 384; // gte-small

// ── v3: guides / skills / mcp ───────────────────────────────────────

export interface GuideLink {
  type: string; // official | course | video | article | book | opensource…
  label: string;
  url: string;
}

export interface GuideRow {
  id?: number;
  source: string;
  domain: string;
  track: string | null;
  node_id: string | null;
  title: string;
  body: string;
  links: GuideLink[];
  position: number;
  license: string | null;
  tokens: number;
  content_hash: string;
  embedding?: number[] | null;
}

export interface SkillRow {
  id: string;
  source: string; // 'skills.sh' | 'ui-skills' | 'github'
  name: string;
  description: string | null;
  repo_url: string | null;
  raw_url: string | null;
  body: string;
  frontmatter: Record<string, unknown>;
  files: { path: string; bytes?: number }[];
  content_hash: string;
  license: string | null;
  installs: number;
  trust: Record<string, unknown>;
  tokens: number;
  embedding?: number[] | null;
}

export interface McpServerRow {
  name: string;
  description: string | null;
  url: string | null;
  repo: string | null;
  registry: string;
  verified: boolean;
  use_count: number;
}

export const GUIDE_DOMAINS = [
  "frontend",
  "backend",
  "fullstack",
  "devops",
  "cloud",
  "android",
  "ios",
  "mobile-multiplatform",
  "desktop",
  "gamedev",
  "consoles-homebrew",
  "tv",
  "wearables",
  "tablets",
  "osdev",
  "kernel-drivers",
  "embedded",
  "linux-distros",
  "ai-llm",
  "data",
  "security",
  "databases",
  "languages",
  "tools",
  "cs-fundamentals",
  "architecture",
  "qa-testing",
  "blockchain",
  "career",
] as const;

export type GuideDomain = (typeof GUIDE_DOMAINS)[number];
