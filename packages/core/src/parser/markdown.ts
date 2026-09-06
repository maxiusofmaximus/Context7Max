import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import type { Root, Heading, Code, Content } from "mdast";
import { countTokens } from "../tokens.js";
import { hashContent } from "../hash.js";
import type { ParsedPage } from "../types.js";

// ── MDX preprocessing ───────────────────────────────────────────────
// MDX breaks standard markdown parsers; strip JSX/ESM wrappers while
// keeping their inner markdown content (best-effort, mirrors what
// "docs → llms.txt" pipelines do).

const IMPORT_EXPORT_RE = /^[ \t]*(?:import|export)\b[^\n]*$/gm;
/** JSX block tags that only wrap content (Card, Tabs, Note...) — drop the tag lines themselves */
const JSX_TAG_LINE_RE = /^[ \t]*<\/?[A-Za-z][A-Za-z0-9._-]*[^>]*>[ \t]*$/gm;
/** Inline JSX tags inside text: <Component prop="x"> → "" (keep inner text for paired) */
const JSX_INLINE_OPEN_RE = /<(\/?)[A-Za-z][A-Za-z0-9._-]*(?:\s[^<>]*?)?>/g;
/** JSX expressions {foo} — drop */
const JSX_EXPR_RE = /^\{[^}\n]*\}$/gm;

export function stripMdx(content: string): string {
  return content
    .replace(IMPORT_EXPORT_RE, "")
    .replace(JSX_EXPR_RE, "")
    .replace(JSX_TAG_LINE_RE, "")
    .replace(JSX_INLINE_OPEN_RE, "");
}

function toPlainText(node: Content | Root): string {
  let out = "";
  visit(node as never, (n: { type: string; value?: unknown }) => {
    if (n.type === "text" || n.type === "inlineCode" || n.type === "code") {
      if (typeof n.value === "string") out += n.value;
    }
  });
  return out.trim();
}

function humanizeFilename(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.[a-z.]+$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  if (!words) return "Overview";
  if (["index", "readme", "intro", "introduction"].includes(words.toLowerCase()))
    return "Introduction";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ParseOptions {
  path: string;
  sourceUrl?: string;
  /** minimum trimmed length of a code block to keep */
  minCodeChars?: number;
  /** target size of prose chunks */
  maxChunkChars?: number;
}

export function parseMarkdown(content: string, opts: ParseOptions): ParsedPage {
  const { path, sourceUrl } = opts;
  const minCode = opts.minCodeChars ?? 12;
  const maxChunk = opts.maxChunkChars ?? 1400;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"]);

  const tree = processor.parse(stripMdx(content)) as Root;

  // heading stack: [{depth, text}]
  const stack: { depth: number; text: string }[] = [];
  let pageTitle: string | null = null;
  let pendingDesc: string | null = null;

  const codeSnippets: ParsedPage["codeSnippets"] = [];
  const infoSnippets: ParsedPage["infoSnippets"] = [];
  const seenHashes = new Set<string>();

  // prose accumulator
  let prose: string[] = [];
  let proseLen = 0;

  const breadcrumb = () =>
    stack.length ? stack.map((s) => s.text).join(" > ") : null;
  const pageTitleText = () => pageTitle ?? humanizeFilename(path);

  function flushProse() {
    const text = prose.join("\n\n").trim();
    prose = [];
    proseLen = 0;
    if (text.length < 80) return;
    infoSnippets.push({
      page_title: pageTitleText(),
      breadcrumb: breadcrumb(),
      content: text,
      tokens: countTokens(text),
      source_url: sourceUrl ?? null,
      source_file: path,
      content_hash: hashContent(text),
    });
  }

  function addProse(text: string) {
    if (!text.trim()) return;
    prose.push(text.trim());
    proseLen += text.length;
    if (proseLen >= maxChunk) flushProse();
  }

  function addCode(node: Code) {
    const code = node.value.replace(/\s+$/, "");
    const trimmed = code.trim();
    if (trimmed.length < minCode) return;
    const hash = hashContent(trimmed);
    if (seenHashes.has(hash)) return;
    seenHashes.add(hash);

    const title =
      (stack.length ? stack[stack.length - 1]!.text : null) ??
      pageTitleText();
    const description =
      pendingDesc && pendingDesc.length <= 400 ? pendingDesc : null;
    pendingDesc = null;

    codeSnippets.push({
      title,
      description,
      language: node.lang ?? null,
      code: trimmed,
      tokens: countTokens(trimmed),
      source_url: sourceUrl
        ? `${sourceUrl}${sourceUrl.includes("#") ? "" : ""}`
        : null,
      source_file: path,
      line_start: node.position?.start.line ?? null,
      line_end: node.position?.end.line ?? null,
      breadcrumb: breadcrumb(),
      content_hash: hash,
    });
  }

  // Walk the document in order, tracking headings + code anywhere in the tree.
  visit(tree as never, (node: {
    type: string;
    depth?: number;
    lang?: string | null;
    value?: string;
    position?: { start: { line: number }; end: { line: number } };
    children?: unknown[];
  }, _index: number | null, parent: { type?: string } | null) => {
    if (node.type === "heading") {
      const headingNode = node as unknown as Heading;
      const text = toPlainText(headingNode);
      const depth = headingNode.depth;
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
      stack.push({ depth, text });
      if (pageTitle === null && depth === 1 && text) {
        pageTitle = text;
      }
      pendingDesc = null;
      return;
    }
    if (node.type === "code") {
      flushProse();
      addCode(node as unknown as Code);
      return;
    }
    if (
      node.type === "paragraph" ||
      node.type === "list" ||
      node.type === "table" ||
      node.type === "blockquote"
    ) {
      // only accumulate reasonably-levelled prose (avoid double-adding nested)
      if (parent && (parent.type === "blockquote" || parent.type === "listItem" || parent.type === "list")) {
        return; // handled at the top level container
      }
      const text = toPlainText(node as unknown as Content);
      if (text) {
        addProse(text);
        if (node.type === "paragraph" && text.length <= 400) {
          pendingDesc = text;
        } else {
          pendingDesc = null;
        }
      }
    }
  });

  flushProse();

  return {
    path,
    title: pageTitleText(),
    sourceUrl: sourceUrl ?? null,
    codeSnippets,
    infoSnippets,
  };
}
