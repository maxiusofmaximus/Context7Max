// Bundles every endpoint in src/ → api/ as self-contained CJS files.
// This makes Vercel functions dependency-free at runtime (workspace packages
// like @ctx7max/core get inlined).
import { build } from "esbuild";
import { globby } from "globby";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const srcDir = join(here, "src");
// Functions are emitted at the repo ROOT api/ dir (the Vercel project root).
const outDir = join(repoRoot, "api");

const entries = await globby("**/*.ts", { cwd: srcDir, absolute: true });

rmSync(outDir, { recursive: true, force: true });

for (const entry of entries) {
  const rel = relative(srcDir, entry).replace(/\.ts$/, ".js");
  const out = join(outDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    minify: false,
    sourcemap: false,
    logLevel: "silent",
  });
}

// Functions dir must be CJS regardless of the package root "type".
writeFileSync(
  join(outDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);
console.log(`bundled ${entries.length} endpoint(s) → api/`);
