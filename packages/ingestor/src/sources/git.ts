import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
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
    const cloneArgs = ["clone", "--depth", "1", "--filter=blob:none"];
    if (subPath) cloneArgs.push("--sparse");
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
    }

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

    return {
      libraryId: `/git/${host.replace(/\./g, "-")}/${repoName}`.toLowerCase(),
      title: config.projectTitle ?? repoName,
      description: config.description ?? `Git repository at ${host}`,
      sourceType: "github", // storage-wise identical to github
      sourceUrl: browserBase,
      branch: branch ?? null,
      repoSha: sha,
      license: null,
      stars: 0,
      versions: [],
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
