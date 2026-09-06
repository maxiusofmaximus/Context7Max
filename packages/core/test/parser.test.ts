import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseRst, parseDocument } from "../src/parser/index.js";
import { shouldIncludePath, DOC_EXTENSIONS } from "../src/config.js";

const MD_SAMPLE = `---
title: Getting Started
---
import { Tabs } from '@components/Tabs'

# Getting Started

Install the package with your favorite manager.

<Tabs>
\`\`\`bash
npm install cool-lib
\`\`\`
</Tabs>

## Basic usage

Create a client instance with your API key.

\`\`\`ts
import { CoolLib } from "cool-lib";

const client = new CoolLib({ apiKey: process.env.API_KEY });
const result = await client.doThing("hello");
console.log(result);
\`\`\`

\`\`\`ts
import { CoolLib } from "cool-lib";

const client = new CoolLib({ apiKey: process.env.API_KEY });
const result = await client.doThing("hello");
console.log(result);
\`\`\`

### With options

You can pass extra options to tune the client behavior, including retries, timeouts, and a custom fetch implementation for exotic runtimes such as Bun or Deno.

\`\`\`ts
const client = new CoolLib({ apiKey: "x", retries: 3 });
\`\`\`
`;

test("markdown: extracts code snippets with headings, dedup", () => {
  const page = parseMarkdown(MD_SAMPLE, { path: "docs/getting-started.mdx" });
  assert.equal(page.title, "Getting Started");
  assert.equal(page.codeSnippets.length, 3, "dedup keeps 3 of 4 blocks");
  assert.equal(page.codeSnippets[0]!.language, "bash");
  assert.equal(page.codeSnippets[0]!.breadcrumb, "Getting Started");
  assert.equal(
    page.codeSnippets[1]!.description,
    "Create a client instance with your API key.",
  );
  assert.equal(
    page.codeSnippets[2]!.breadcrumb,
    "Getting Started > Basic usage > With options",
  );
  assert.ok(page.infoSnippets.length >= 1);
  assert.ok(page.codeSnippets[0]!.content_hash);
});

test("markdown: handles mdx leftovers gracefully", () => {
  const page = parseMarkdown(
    `# Hi\n\n<Callout emoji="💡">\nNote the thing\n</Callout>\n\n\`\`\`js\nconsole.log("x")\n\`\`\`\n`,
    { path: "a.md" },
  );
  assert.equal(page.codeSnippets.length, 1);
  assert.equal(page.codeSnippets[0]!.language, "js");
});

const RST_SAMPLE = `
Installation
============

Install it with pip:

.. code-block:: bash

   pip install cool-lib

Quickstart
----------

Import and use::

   import cool_lib
   cool_lib.run()
`;

test("rst: sections and code blocks", () => {
  const page = parseRst(RST_SAMPLE, { path: "docs/index.rst" });
  assert.equal(page.title, "Installation");
  assert.ok(page.codeSnippets.length >= 2);
  assert.equal(page.codeSnippets[0]!.language, "bash");
  assert.ok(page.codeSnippets[0]!.code.includes("pip install"));
});

test("dispatcher: ipynb", () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["# Demo\n", "\nSome text for the notebook that is long enough to be kept as prose. Yes, quite a bit of text so it exceeds the minimal chunk threshold of eighty characters for sure."] },
      { cell_type: "code", source: ["import pandas as pd\ndf = pd.DataFrame()\nprint(df)"] },
    ],
    metadata: { language_info: { name: "python" } },
  });
  const page = parseDocument({ path: "examples/demo.ipynb", content: nb });
  assert.equal(page.codeSnippets.length, 1);
  assert.equal(page.codeSnippets[0]!.language, "python");
});

test("path filtering", () => {
  const none = { folders: [], excludeFolders: [], excludeFiles: [] };
  assert.equal(shouldIncludePath("docs/guide.md", none), true);
  assert.equal(shouldIncludePath("node_modules/x/README.md", none), false);
  assert.equal(shouldIncludePath("CHANGELOG.md", none), false);
  assert.equal(shouldIncludePath("docs/archive/old.md", none), false);
  assert.equal(
    shouldIncludePath("docs/guide.md", {
      ...none,
      excludeFiles: ["guide.md"],
    }),
    false,
  );
  // folders whitelist: root markdown always in, other paths must be under folders
  assert.equal(
    shouldIncludePath("README.md", { ...none, folders: ["docs"] }),
    true,
  );
  assert.equal(
    shouldIncludePath("src/notes.md", { ...none, folders: ["docs"] }),
    false,
  );
  assert.equal(
    shouldIncludePath("docs/api/x.md", { ...none, folders: ["docs"] }),
    true,
  );
  assert.ok(DOC_EXTENSIONS.includes(".mdx"));
});
