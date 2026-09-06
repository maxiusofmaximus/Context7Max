/**
 * Smoke test: preview + parse a real GitHub repo without touching the DB.
 * Usage: pnpm tsx scripts/smoke-preview.mts [githubUrl]
 */
import { previewSource, fetchSource } from "@ctx7max/ingestor";
import { parseDocument } from "@ctx7max/core";

const url = process.argv[2] ?? "https://github.com/colinhacks/zod";

console.log(`→ preview ${url}`);
const preview = await previewSource(url, {
  type: "auto",
  env: { supabaseUrl: "http://localhost", serviceRoleKey: "x" },
});
console.log(
  `  ✓ ${preview.libraryId} | ${preview.files.length} doc files | ${(preview.totalBytes / 1024).toFixed(0)} KB | versions: ${preview.versions.slice(0, 3).join(", ") || "(none)"}`,
);
console.log(`  first files: ${preview.files.slice(0, 6).map((f) => f.path).join(", ")}`);

const source = await fetchSource(url, {
  type: "auto",
  env: { supabaseUrl: "http://localhost", serviceRoleKey: "x" },
});
let code = 0;
let info = 0;
for (const f of source.files) {
  const parsed = parseDocument(f);
  code += parsed.codeSnippets.length;
  info += parsed.infoSnippets.length;
}
console.log(`  ✓ parsed → ${code} code snippets, ${info} info snippets`);

// sample a few snippets to eyeball quality
const sample = parseDocument(source.files[0]!);
for (const s of sample.codeSnippets.slice(0, 3)) {
  console.log(`\n—— snippet: ${s.title} (${s.language}, ${s.tokens} tok)`);
  console.log(`   desc: ${(s.description ?? "").slice(0, 90)}`);
  console.log(`   ${s.code.split("\n").slice(0, 3).join("\n   ")}…`);
}
