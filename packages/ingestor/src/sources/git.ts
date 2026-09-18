import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { fetchGitHubMeta } from "./github.js";
import {
  CODE_EXTENSIONS,
  DOC_EXTENSIONS,
  EXAMPLE_FOLDER_HINTS,
  parseLibraryConfig,
  shouldIncludePath,
  type DocFile,
  type IngestSourceResult,
} from "@ctx7max/core";

const execFileP = promisify(execFile);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 1500;
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;

/**
 * Generic git source — works with ANY git host (git.kernel.org, GitLab,
 * cgit, savannah, code.qt.io…). Uses a shallow sparse clone.
 * URL format: https://host/path/repo.git[#sub/path][@branch]
 */
export async function fetchGitSource(url: string): Promise<IngestSourceResult> {
  const { repoUrl, subPath, branch } = parseGitUrl(url);
  const workDir = mkdtempSync(join(tmpdir(), "ctx7max-git-"));

  try {
    // Importante: --no-checkout para evitar fallos en repos con nombres
    // ilegales en Windows (p.ej. ':' o caracteres NTFS-reservados); el
    // checkout (todo o sparse) ocurre después.
    const cloneArgs = ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout"];
    if (branch) cloneArgs.push("--branch", branch);
    cloneArgs.push("--", repoUrl, workDir);

    await execFileP("git", cloneArgs, {
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch((err) => {
      throw new Error(
        `git clone failed for ${repoUrl}: ${(err as Error).message.slice(0, 300)}`,
      );
    });

    if (subPath) {
      await execFileP("git", ["sparse-checkout", "set", subPath], {
        cwd: workDir,
        timeout: 60_000,
      });
    } else {
      // Sin subpath: sparse NON-cone que excluye binarios pesados (el 90%
      // del tamaño de cursos/repos grandes son imágenes/media/modelos).
      // Combinado con --filter=blob:none, los blobs excluidos no se bajan.
      await execFileP(
        "git",
        [
          "sparse-checkout",
          "set",
          "--no-cone",
          "*",
          "!*.png",
          "!*.jpg",
          "!*.jpeg",
          "!*.gif",
          "!*.webp",
          "!*.svg",
          "!*.mp4",
          "!*.mov",
          "!*.webm",
          "!*.zip",
          "!*.tar",
          "!*.gz",
          "!*.7z",
          "!*.pt",
          "!*.pth",
          "!*.bin",
          "!*.safetensors",
          "!*.onnx",
          "!*.parquet",
          "!*.glb",
          "!*.woff",
          "!*.woff2",
          "!*.ttf",
          "!*.otf",
          "!*.ico",
          "!*.pdf",
        ],
        { cwd: workDir, timeout: 60_000 },
      ).catch(() => {});
    }
    // checkout (sparse o completo); --guess= false para evitar heurísticas
    await execFileP(
      "git",
      ["-c", "core.protectNTFS=false", "checkout"],
      { cwd: workDir, timeout: 120_000 },
    ).catch(() => {});

    // resolved HEAD sha for staleness tracking
    let sha: string | null = null;
    try {
      const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: workDir });
      sha = stdout.trim();
    } catch { /* non-fatal */ }

    // optional in-repo config
    let config = parseLibraryConfig(null);
    for (const name of ["context7max.json", "context7.json"]) {
      try {
        const raw = readFileSync(join(workDir, name), "utf8");
        config = parseLibraryConfig(JSON.parse(raw));
        break;
      } catch { /* no config */ }
    }

    const filterOpts = {
      folders: config.folders,
      excludeFolders: config.excludeFolders,
      excludeFiles: config.excludeFiles,
    };

    const repoName = repoUrl.split("/").pop()!.replace(/\.git$/, "");
    const host = new URL(repoUrl).hostname.replace(/^www\./, "");
    const browserBase = repoUrl.replace(/\.git$/, "");
    // IDs limpios: en github.com usamos /org/repo igual que la fuente github
    let libraryId = `/git/${host.replace(/\./g, "-")}/${repoName}`.toLowerCase();
    if (host === "github.com") {
      const m = repoUrl.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#@]|$)/);
      if (m) libraryId = `/${m[1]}/${m[2]}`;
    }

    const files: DocFile[] = [];
  let total = 0;
    walk(subPath ? join(workDir, subPath) : workDir, workDir, (absPath) => {
      if (files.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) return;
      const relPath = relative(workDir, absPath).replace(/\\/g, "/");
      if (relPath.startsWith(".git/")) return;
      const lower = relPath.toLowerCase();
      const isDoc = DOC_EXTENSIONS.some((e) => lower.endsWith(e));
      const isCode = CODE_EXTENSIONS.some((e) => lower.endsWith(e));
      const inExample = EXAMPLE_FOLDER_HINTS.some((h) => lower.split("/").includes(h));
      if (!isDoc && !(config.includeExamples && isCode && inExample)) return;
      if (!shouldIncludePath(relPath, filterOpts)) return;
      const size = statSync(absPath).size;
      if (size > MAX_FILE_BYTES || size === 0) return;
      const content = readFileSync(absPath, "utf8");
      if (!content.trim()) return;
      files.push({
        path: relPath,
        content,
        sourceUrl: `${browserBase}/blob/${branch ?? "HEAD"}/${relPath}`,
      });
      total += size;
    });

    if (files.length === 0) {
      throw new Error(`No documentation files found in ${repoUrl} (${subPath ?? "root"})`);
    }

    // Metadatos reales cuando el host es GitHub (stars, última versión, license)
    let stars = 0;
    let versions: string[] = [];
    let license: string | null = null;
    let description = config.description ?? null;
    if (host === "github.com") {
      const m = repoUrl.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#@]|$)/);
      if (m) {
        try {
          const { meta, tags } = await fetchGitHubMeta({ owner: m[1]!, repo: m[2]! }, undefined);
          stars = meta.stargazers_count ?? 0;
          versions = tags;
          license = meta.license?.spdx_id ?? null;
          description = description ?? meta.description;
        } catch { /* metadata opcional */ }
      }
    }

    return {
      libraryId,
      title: config.projectTitle ?? repoName,
      description,
      sourceType: "github", // storage-wise identical to github
      sourceUrl: browserBase,
      branch: branch ?? null,
      repoSha: sha,
      license,
      stars,
      versions,
      files,
      rules: config.rules,
      settings: { ...config },
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}

function parseGitUrl(url: string): { repoUrl: string; subPath?: string; branch?: string } {
  let u = url.trim();
  let branch: string | undefined;
  let subPath: string | undefined;
  const branchIdx = u.indexOf("@");
  if (branchIdx > 0) {
    branch = u.slice(branchIdx + 1);
    u = u.slice(0, branchIdx);
  }
  const hashIdx = u.indexOf("#");
  if (hashIdx > 0) {
    subPath = u.slice(hashIdx + 1).replace(/^\/+|\/+$/g, "");
    u = u.slice(0, hashIdx);
  }
  if (!/\.git$/i.test(u) && !u.endsWith("/")) u += "";
  return { repoUrl: u, subPath, branch };
}

function walk(dir: string, base: string, visit: (abs: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      walk(abs, base, visit);
    } else if (entry.isFile()) {
      visit(abs);
    }
  }
}
