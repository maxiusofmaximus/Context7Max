import { defineConfig } from "tsup";

const bundled = [
  /^@ctx7max\//,
  /^commander/,
  /^picocolors/,
  /^zod/,
  /^js-tiktoken/,
  /^micromatch/,
  /^remark/,
  /^unified/,
  /^unist/,
  /^mdast/,
  /^yaml/,
  /^fflate/,
  /^turndown/,
  /^@mozilla\//,
  /^@supabase\//,
  /^@modelcontextprotocol\//,
  /^lru-cache/,
];

export default defineConfig([
  {
    // The executable: CJS = zero ESM/CJS interop traps for a bin entry.
    entry: { cli: "src/cli.ts" },
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    dts: false,
    clean: true,
    bundle: true,
    splitting: false,
    sourcemap: false,
    target: "node18",
    platform: "node",
    noExternal: bundled,
    external: ["jsdom", "canvas"],
  },
  {
    // Library entry for programmatic use.
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: false,
    bundle: true,
    splitting: false,
    sourcemap: false,
    target: "node18",
    platform: "node",
    noExternal: bundled,
    external: ["jsdom", "canvas"],
  },
]);
