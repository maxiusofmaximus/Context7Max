// Adds the shebang to the built CLI entry (needed for global installs).
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../dist/cli.cjs", import.meta.url);
const content = readFileSync(file, "utf8");
if (!content.startsWith("#!")) {
  writeFileSync(file, "#!/usr/bin/env node\n" + content, "utf8");
}
console.log("postbuild: shebang ok");
