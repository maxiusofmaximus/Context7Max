import {
  createDb,
  createJob,
  deleteSnippets,
  embedTexts,
  insertCodeSnippets,
  insertInfoSnippets,
  parseDocument,
  setLibraryState,
  updateJob,
  updateLibraryStats,
  upsertLibrary,
  countTokens,
  type CodeSnippetRow,
  type DbEnv,
  type DocFile,
  type InfoSnippetRow,
  type IngestSourceResult,
  type JobRow,
  type LibraryRow,
} from "@ctx7max/core";
import { fetchGitHubSource } from "./sources/github.js";
import { fetchLlmsTxtSource } from "./sources/llmstxt.js";
import { fetchOpenApiSource } from "./sources/openapi.js";

export type SourceKind =
  | "github"
  | "llmstxt"
  | "website"
  | "openapi"
  | "git"
  | "pdf"
  | "wiki"
  | "auto";

export interface IngestOptions {
  env: DbEnv;
  actor?: JobRow["actor"];
  embed?: boolean;
  githubToken?: string;
  type?: SourceKind;
  version?: string;
  onLog?: (msg: string) => void;
}

export interface IngestResult {
  libraryId: string;
  state: "finalized";
  files: number;
  codeSnippets: number;
  infoSnippets: number;
  totalTokens: number;
  embeddedPct: number;
}

export interface SourcePreview {
  libraryId: string;
  title: string;
  sourceType: string;
  branch: string | null;
  versions: string[];
  files: { path: string; bytes: number }[];
  fileCount: number;
  totalBytes: number;
}

export function detectSourceKind(url: string, explicit?: SourceKind): Exclude<SourceKind, "auto"> {
  if (explicit && explicit !== "auto") return explicit;
  if (/github\.com[/:][^/]+\/[^/#?]+/i.test(url)) return "github";
  if (/llms(-full)?\.txt([?#].*)?$/i.test(url)) return "llmstxt";
  if (/\.pdf([?#].*)?$/i.test(url)) return "pdf";
  if (/open\s*api|swagger/i.test(url) || /\.(ya?ml|json)$/i.test(url)) return "openapi";
  if (/^https?:\/\/[^/]*(wiki\.|wiki\.)/i.test(url) || /mediawiki|api\.php/i.test(url)) return "wiki";
  if (url.endsWith(".git")) return "git";
  if (url.includes("#") && /gitlab|git\.|cgit|savannah/i.test(url)) return "git";
  return "website";
}

export async function fetchSource(url: string, opts: IngestOptions): Promise<IngestSourceResult> {
  const kind = detectSourceKind(url, opts.type);
  switch (kind) {
    case "github":
      return fetchGitHubSource(url, { token: opts.githubToken, ref: opts.version });
    case "llmstxt":
      return fetchLlmsTxtSource(url);
    case "website": {
      // lazy load: pulls jsdom only when actually crawling HTML
      const { fetchWebsiteSource } = await import("./sources/website.js");
      return fetchWebsiteSource(url);
    }
    case "openapi":
      return fetchOpenApiSource(url);
    case "git": {
      const { fetchGitSource } = await import("./sources/git.js");
      return fetchGitSource(url);
    }
    case "pdf": {
      const { fetchPdfSource } = await import("./sources/pdf.js");
      return fetchPdfSource(url);
    }
    case "wiki": {
      const { fetchWikiSource } = await import("./sources/wiki.js");
      return fetchWikiSource(url);
    }
  }
}

/** Rules: cap count/length — they are third-party text, handled as untrusted downstream. */
function sanitizeRules(rules: string[]): string[] {
  return rules.slice(0, 20).map((r) => r.slice(0, 500));
}

function embedTextsForCode(s: { title: string; description: string | null; language: string | null; breadcrumb: string | null; code: string }): string {
  const text = [s.breadcrumb, s.title, s.description, s.language, s.code.slice(0, 1000)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1400)
    .trim();
  return text || "(snippet)";
}

function embedTextsForInfo(s: { page_title: string | null; breadcrumb: string | null; content: string }): string {
  const text = [s.breadcrumb, s.page_title, s.content.slice(0, 1200)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1400)
    .trim();
  return text || "(snippet)";
}

function parseDocumentSafe(file: DocFile) {
  try {
    return parseDocument(file);
  } catch {
    return null;
  }
}

export async function previewSource(url: string, opts: IngestOptions): Promise<SourcePreview> {
  const source = await fetchSource(url, opts);
  return {
    libraryId: source.libraryId,
    title: source.title,
    sourceType: source.sourceType,
    branch: source.branch,
    versions: source.versions,
    files: source.files.map((f) => ({ path: f.path, bytes: f.content.length })),
    fileCount: source.files.length,
    totalBytes: source.files.reduce((a, f) => a + f.content.length, 0),
  };
}

/**
 * Full ingestion pipeline for one source:
 * fetch → parse → dedup → cap → embed → upsert. Job state visible throughout.
 */
export async function ingestSource(url: string, opts: IngestOptions): Promise<IngestResult> {
  const db = createDb(opts.env);
  const log = opts.onLog ?? (() => {});
  const doEmbed = opts.embed !== false;

  // 1) fetch
  log("fetching source…");
  const source = await fetchSource(url, opts);

  // external sources (monorepo-friendly): merge doc files
  const externals = (source.settings as { externalSources?: { type: SourceKind; url: string }[] })
    .externalSources ?? [];
  for (const ext of externals.slice(0, 3)) {
    try {
      log(`fetching external source ${ext.url}…`);
      const extra = await fetchSource(ext.url, { ...opts, type: ext.type });
      source.files.push(...extra.files);
    } catch (err) {
      log(`external source failed: ${ext.url} — ${(err as Error).message}`);
    }
  }

  const libraryId = source.libraryId;
  const version = opts.version ?? (source.sourceType === "github" ? source.branch ?? "main" : "main");

  // 2) job + library row
  const jobId = await createJob(db, {
    library_id: libraryId,
    action: "ingest",
    status: "running",
    stage: "parsing",
    message: `source: ${source.sourceType} ${source.sourceUrl}`,
    stats: {},
    actor: opts.actor ?? "cli",
  });

  const libraryRow: LibraryRow = {
    id: libraryId,
    title: source.title,
    description: source.description,
    source_type: source.sourceType,
    source_url: source.sourceUrl,
    branch: source.branch,
    repo_sha: source.repoSha,
    license: source.license,
    stars: source.stars,
    trust_score: Math.min(10, Math.max(0, Math.round(source.stars > 50000 ? 10 : source.stars > 5000 ? 9 : source.stars > 500 ? 7 : source.stars > 50 ? 5 : 3))),
    state: "parsing",
    state_message: null,
    total_tokens: 0,
    total_snippets: 0,
    versions: source.versions,
    rules: sanitizeRules(source.rules),
    settings: source.settings,
    quality: {},
  };
  await upsertLibrary(db, libraryRow);

  try {
    // 3) parse
    const codeRows: Omit<CodeSnippetRow, "id">[] = [];
    const infoRows: Omit<InfoSnippetRow, "id">[] = [];
    const seenCode = new Set<string>();
    const seenInfo = new Set<string>();
    let filesWithCode = 0;
    for (const file of source.files) {
      const parsed = parseDocumentSafe(file);
      if (!parsed) continue;
      if (parsed.codeSnippets.length > 0) filesWithCode++;
      for (const s of parsed.codeSnippets) {
        if (seenCode.has(s.content_hash)) continue;
        seenCode.add(s.content_hash);
        codeRows.push({ ...s, library_id: libraryId, version });
      }
      for (const s of parsed.infoSnippets) {
        if (seenInfo.has(s.content_hash)) continue;
        seenInfo.add(s.content_hash);
        infoRows.push({ ...s, library_id: libraryId, version });
      }
    }

    // 4) quality gate — replicate Context7's no_code_found behavior
    if (codeRows.length === 0) {
      await setLibraryState(db, libraryId, "error", "no_code_found: documentation has no code examples");
      await updateJob(db, jobId, { status: "failed", stage: "parsing", message: "no_code_found" });
      throw new Error(`no_code_found: ${libraryId} documentation contains no code snippets`);
    }

    // 5) cap snippets (prefer described, then shorter ones — more signal per token)
    const maxSnippets =
      (source.settings as { maxSnippets?: number }).maxSnippets ?? 2000;
    const cappedCode =
      codeRows.length > maxSnippets
        ? codeRows
            .map((s) => ({ s, pref: (s.description ? 1 : 0) * 1000000 + Math.min(s.tokens, 900) }))
            .sort((a, b) => b.pref - a.pref)
            .slice(0, maxSnippets)
            .map((x) => x.s)
        : codeRows;
    const cappedInfo = infoRows.slice(0, Math.max(1500, maxSnippets));

    // 6) embeddings
    let embedded = 0;
    if (doEmbed) {
      await updateJob(db, jobId, { stage: "embedding" });
      await setLibraryState(db, libraryId, "embedding");
      const codeVecs = await embedTexts(opts.env, cappedCode.map(embedTextsForCode));
      cappedCode.forEach((row, i) => {
        row.embedding = codeVecs[i] ?? null;
        if (row.embedding) embedded++;
      });
      const infoVecs = await embedTexts(opts.env, cappedInfo.map(embedTextsForInfo));
      cappedInfo.forEach((row, i) => {
        row.embedding = infoVecs[i] ?? null;
      });
    }

    // 7) store (replace same version)
    await deleteSnippets(db, libraryId, version);
    await insertCodeSnippets(db, cappedCode);
    await insertInfoSnippets(db, cappedInfo);

    const totalTokens =
      cappedCode.reduce((a, s) => a + s.tokens, 0) +
      cappedInfo.reduce((a, s) => a + s.tokens, 0);

    await updateLibraryStats(db, libraryId, {
      total_tokens: totalTokens,
      total_snippets: cappedCode.length,
      versions: source.versions,
      repo_sha: source.repoSha,
      quality: {
        docFiles: source.files.length,
        filesWithCode,
        codeCoveragePct: source.files.length
          ? Math.round((filesWithCode / source.files.length) * 1000) / 10
          : 0,
        infoSnippets: cappedInfo.length,
        crawledAt: new Date().toISOString(),
      },
    });
    await setLibraryState(db, libraryId, "finalized");
    await updateJob(db, jobId, {
      status: "done",
      stage: "finalized",
      message: `${cappedCode.length} code + ${cappedInfo.length} info snippets`,
      stats: {
        files: source.files.length,
        codeSnippets: cappedCode.length,
        infoSnippets: cappedInfo.length,
        totalTokens,
      },
    });

    return {
      libraryId,
      state: "finalized",
      files: source.files.length,
      codeSnippets: cappedCode.length,
      infoSnippets: cappedInfo.length,
      totalTokens,
      embeddedPct: cappedCode.length ? Math.round((embedded / cappedCode.length) * 100) : 0,
    };
  } catch (err) {
    const message = (err as Error).message;
    await setLibraryState(db, libraryId, "error", message.slice(0, 500)).catch(() => {});
    await updateJob(db, jobId, {
      status: "failed",
      message: message.slice(0, 500),
    }).catch(() => {});
    throw err;
  }
}
