import { countTokens } from "../tokens.js";
import { hashContent } from "../hash.js";
import type { ParsedPage } from "../types.js";
import type { ParseOptions } from "./markdown.js";

const SECTION_CHARS = ["=", "-", "~", "^", '"', "'", "#", "*", "+", ":"];

interface RstLine {
  raw: string;
  indent: number;
  text: string;
}

function isSectionUnderline(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return false;
  const ch = t[0]!;
  return SECTION_CHARS.includes(ch) && t.split("").every((c) => c === ch);
}

/**
 * Minimal but effective reStructuredText parser: sections + code-block /
 * literal directives + prose chunks. Good enough for Sphinx-style docs.
 */
export function parseRst(content: string, opts: ParseOptions): ParsedPage {
  const { path, sourceUrl } = opts;
  const minCode = opts.minCodeChars ?? 12;

  const lines: RstLine[] = content.replace(/\r\n/g, "\n").split("\n").map((raw) => ({
    raw,
    indent: raw.length - raw.trimStart().length,
    text: raw.trim(),
  }));

  const codeSnippets: ParsedPage["codeSnippets"] = [];
  const infoSnippets: ParsedPage["infoSnippets"] = [];
  const seenHashes = new Set<string>();

  // heading stack: char-level hierarchy
  const levels: string[] = []; // order of underline chars as first seen
  const stack: { level: number; text: string }[] = [];
  let pageTitle: string | null = null;
  let pendingDesc: string | null = null;
  let prose: string[] = [];
  let proseLen = 0;

  const pageTitleText = () => pageTitle ?? humanize(path);
  const breadcrumb = () =>
    stack.length ? stack.map((s) => s.text).join(" > ") : null;

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

  function addCode(code: string, lang: string | null) {
    const trimmed = code.replace(/\s+$/, "").trim();
    if (trimmed.length < minCode) return;
    const hash = hashContent(trimmed);
    if (seenHashes.has(hash)) return;
    seenHashes.add(hash);
    codeSnippets.push({
      title: stack.length ? stack[stack.length - 1]!.text : pageTitleText(),
      description: pendingDesc && pendingDesc.length <= 400 ? pendingDesc : null,
      language: lang,
      code: trimmed,
      tokens: countTokens(trimmed),
      source_url: sourceUrl ?? null,
      source_file: path,
      line_start: null,
      line_end: null,
      breadcrumb: breadcrumb(),
      content_hash: hash,
    });
    pendingDesc = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];

    // ── section header: text line followed by underline ──
    if (line.text && next && isSectionUnderline(next.raw) && next.text.length >= line.text.length * 0.9) {
      const ch = next.text[0]!;
      let level = levels.indexOf(ch);
      if (level === -1) {
        levels.push(ch);
        level = levels.length - 1;
      }
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, text: line.text });
      if (pageTitle === null && level === 0) pageTitle = line.text;
      pendingDesc = null;
      i++; // consume underline
      continue;
    }

    // ── code directive: .. code-block:: lang ──
    const directiveMatch = line.text.match(/^\.\.\s+(?:code-block|code|sourcecode)::\s*(\S+)?/i);
    if (directiveMatch) {
      flushProse();
      const lang = directiveMatch[1]?.toLowerCase() ?? null;
      // skip directive options + blank lines
      let j = i + 1;
      while (j < lines.length && (lines[j]!.text.startsWith(":") || lines[j]!.text === "")) j++;
      // collect indented block
      const blockIndent = j < lines.length ? lines[j]!.indent : 0;
      const block: string[] = [];
      while (j < lines.length && (lines[j]!.text === "" || lines[j]!.indent >= Math.max(blockIndent, 1))) {
        const l = lines[j]!;
        block.push(l.text === "" ? "" : l.raw.slice(Math.min(blockIndent, l.indent)));
        j++;
      }
      addCode(block.join("\n"), lang);
      i = j - 1;
      continue;
    }

    // ── literal block: paragraph ends with "::" → indented block ──
    if (line.text.endsWith("::") && next && (next.text === "" || next.indent > 0)) {
      const paraText = line.text.slice(0, -2).trim();
      if (paraText) {
        flushProse();
        prose.push(paraText.replace(/``([^`]+)``/g, "`$1`"));
        proseLen += paraText.length;
      }
      flushProse();
      let j = i + 1;
      while (j < lines.length && lines[j]!.text === "") j++;
      const blockIndent = j < lines.length ? lines[j]!.indent : 0;
      const block: string[] = [];
      while (j < lines.length && (lines[j]!.text === "" || lines[j]!.indent >= Math.max(blockIndent, 1))) {
        const l = lines[j]!;
        block.push(l.text === "" ? "" : l.raw.slice(Math.min(blockIndent, l.indent)));
        j++;
      }
      addCode(block.join("\n"), null);
      i = j - 1;
      continue;
    }

    // ── skip other directives ──
    if (line.text.startsWith(".. ")) {
      continue;
    }

    // ── prose ──
    if (line.text === "") {
      continue;
    }
    const cleaned = line.text
      .replace(/``([^`]+)``/g, "`$1`")
      .replace(/:([a-z-]+):`([^`]+)`/gi, "$2");
    prose.push(cleaned);
    proseLen += cleaned.length;
    if (line.text.length <= 400) pendingDesc = line.text;
    if (proseLen >= (opts.maxChunkChars ?? 1400)) flushProse();
  }

  flushProse();

  return {
    path,
    title: pageTitleText(),
    sourceUrl: sourceUrl ?? null,
    codeSnippets,
    infoSnippets,
  };
}

function humanize(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.[a-z.]+$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Overview";
}
