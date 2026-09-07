import { unzipSync } from "fflate";
import {
  CODE_EXTENSIONS,
  DOC_EXTENSIONS,
  EXAMPLE_FOLDER_HINTS,
  parseLibraryConfig,
  shouldIncludePath,
  type Context7MaxConfig,
  type DocFile,
  type IngestSourceResult,
} from "@ctx7max/core";
import { fetchBytes, fetchText } from "../util.js";

const MAX_FILE_BYTES = 512 * 1024; // 512KB per file
const MAX_FILES = 1500;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB zip guardrail (ingestation runs locally or in Actions, not in serverless)

export interface GitHubRef {
  owner: string;
  repo: string;
  /** optional tag/branch override */
  ref?: string;
}

export function parseGitHubUrl(url: string): GitHubRef | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  const repo = m[2]!.replace(/\.git$/, "");
  // /tree/<ref> or /releases/tag/<ref>
  const refMatch = url.match(/\/(tree|releases\/tag)\/([^/?#]+)/);
  return { owner: m[1]!, repo, ref: refMatch?.[2] };
}

function ghHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface GhRepoMeta {
  description: string | null;
  stargazers_count: number;
  default_branch: string;
  license: { spdx_id: string } | null;
  language: string | null;
}

export async function fetchGitHubMeta(ref: GitHubRef, token?: string) {
  const meta = JSON.parse(
    await fetchText(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
      headers: ghHeaders(token),
    }),
  ) as GhRepoMeta;

  let tags: string[] = [];
  try {
    const tagRows = JSON.parse(
      await fetchText(
        `https://api.github.com/repos/${ref.owner}/${ref.repo}/tags?per_page=100`,
        { headers: ghHeaders(token) },
      ),
    ) as { name: string }[];
    tags = tagRows
      .map((t) => t.name)
      .filter((t) => /^v?\d+\.\d+(\.\d+)?([-.][0-9A-Za-z.-]+)?$/.test(t))
      .slice(0, 15);
  } catch {
    /* tags optional */
  }

  return { meta, tags };
}

export interface GitHubSourceOptions {
  token?: string;
  /** specific ref (tag or branch) to ingest */
  ref?: string;
}

/**
 * Download a repo zipball and return all files as a Map<path, bytes>.
 * Shared by the GitHub doc source and the guides ingestor.
 */
export async function fetchGitHubZipFiles(
  owner: string,
  repo: string,
  branch: string = "main",
  token?: string,
): Promise<Map<string, Uint8Array>> {
  const tryBranch = async (ref: string) =>
    fetchBytes(`https://codeload.github.com/${owner}/${repo}/zip/${ref}`, {
      timeoutMs: 180_000,
    });
  let zipBytes: Uint8Array;
  try {
    zipBytes = await tryBranch(branch);
  } catch {
    zipBytes = await tryBranch(branch === "main" ? "master" : "main");
  }
  const files = unzipSync(zipBytes);
  const rootPrefix = Object.keys(files)[0]?.split("/")[0] ?? "";
  const out = new Map<string, Uint8Array>();
  for (const [key, data] of Object.entries(files)) {
    if (key.endsWith("/")) continue;
    const rel = key.slice(rootPrefix.length + 1);
    out.set(rel, data);
  }
  return out;
}

/**
 * Download and extract a GitHub repo's documentation files.
 * Uses the zipball (no git needed) — fast and shallow by nature.
 */
export async function fetchGitHubSource(
  url: string,
  opts: GitHubSourceOptions = {},
): Promise<IngestSourceResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error(`Not a GitHub URL: ${url}`);
  const { meta, tags } = await fetchGitHubMeta(parsed, opts.token);
  const branch = opts.ref ?? parsed.ref ?? meta.default_branch;

  // zipball — handles branches, tags and SHAs uniformly
  const zipBytes = await fetchBytes(
    `https://codeload.github.com/${parsed.owner}/${parsed.repo}/zip/${branch}`,
    { timeoutMs: 120_000 },
  );

  if (zipBytes.byteLength > MAX_TOTAL_BYTES) {
    throw new Error(
      `Repository archive too large (${Math.round(zipBytes.byteLength / 1e6)}MB > 200MB)`,
    );
  }

  const files = unzipSync(zipBytes);
  // zipball wraps everything in "<owner>-<repo>-<sha>/"
  const rootPrefix = Object.keys(files)[0]?.split("/")[0] ?? "";

  // ── config detection (context7max.json wins over context7.json) ──
  let config = parseLibraryConfig(null);
  for (const name of ["context7max.json", "context7.json"]) {
    const key = `${rootPrefix}/${name}`;
    if (files[key]) {
      try {
        config = parseLibraryConfig(
          JSON.parse(new TextDecoder().decode(files[key])),
        );
        break;
      } catch {
        /* invalid config → defaults */
      }
    }
  }

  const blobBase = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${branch}`;
  const docs: DocFile[] = [];
  let total = 0;

  const rel = (key: string) => key.slice(rootPrefix.length + 1);

  const filterOpts = {
    folders: config.folders,
    excludeFolders: config.excludeFolders,
    excludeFiles: config.excludeFiles,
  };

  const names = Object.keys(files).filter(
    (k) => !k.endsWith("/") && k.length > rootPrefix.length + 1,
  );

  for (const key of names) {
    if (docs.length >= MAX_FILES) break;
    const path = rel(key);
    const lower = path.toLowerCase();
    const data = files[key]!;
    if (data.byteLength > MAX_FILE_BYTES) continue;

    const isDoc = DOC_EXTENSIONS.some((e) => lower.endsWith(e));
    const isCode = CODE_EXTENSIONS.some((e) => lower.endsWith(e));
    const inExampleFolder = EXAMPLE_FOLDER_HINTS.some((h) =>
      lower.split("/").includes(h),
    );

    if (!isDoc && !(config.includeExamples && isCode && inExampleFolder))
      continue;
    if (!shouldIncludePath(path, filterOpts)) continue;

    const content = new TextDecoder("utf-8", { fatal: false }).decode(data);
    if (!content.trim()) continue;

    docs.push({
      path,
      content,
      sourceUrl: `${blobBase}/${path}`,
    });
    total += data.byteLength;
  }

  if (docs.length === 0) {
    throw new Error(
      `No documentation files found in ${parsed.owner}/${parsed.repo}@${branch} ` +
        `(config folders: [${config.folders.join(", ") || "all"}])`,
    );
  }

  return {
    libraryId: `/${parsed.owner}/${parsed.repo}`,
    title: config.projectTitle ?? parsed.repo,
    description: config.description ?? meta.description ?? null,
    sourceType: "github",
    sourceUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
    branch,
    // zipball prefix carries the resolved commit sha
    repoSha: rootPrefix.split("-").pop() ?? null,
    license: meta.license?.spdx_id ?? null,
    stars: meta.stargazers_count ?? 0,
    versions: tags,
    files: docs,
    rules: config.rules,
    settings: { ...config },
  };
}

/** Light freshness check: has the default branch moved since repoSha? */
export async function fetchHeadSha(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<string | null> {
  try {
    const data = JSON.parse(
      await fetchText(
        `https://api.github.com/repos/${owner}/${repo}/commits/${branch}?per_page=1`,
        { headers: ghHeaders(token) },
      ),
    ) as { sha: string };
    return data.sha ?? null;
  } catch {
    return null;
  }
}
