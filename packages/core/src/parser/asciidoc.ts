import { countTokens } from "../tokens.js";
import { hashContent } from "../hash.js";
import type { ParsedPage } from "../types.js";
import type { ParseOptions } from "./markdown.js";

const HEADING_RE = /^(={1,6})\s+(.+)$/;
const ADMONITION_RE = /^(NOTE|TIP|WARNING|IMPORTANT|CAUTION):\s*(.*)$/;
const LITERAL_MARKS = new Set(["----", "....", "====", "****", "++++", "____"]);

function humanize(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.[a-z.]+$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Overview";
}

function cleanInline(text: string): string {
  return text
    .replace(/`\+\+\+([^+]+)\+\+\+`/g, "$1")
    .replace(/link:([^\s[]+)\[([^\]]*)\]/g, (_m, url: string, label: string) => `${label || url} (${url})`)
    .replace(/<<([^,>]+),([^>]*)>>/g, "$2")
    .replace(/xref:[^\[]+\[([^\]]*)\]/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\b_([^_]+)_\b/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * AsciiDoc parser (covers the common 90%: sections, code/listing blocks,
 * admonitions, prose). Powers: Raspberry Pi docs, Vulkan spec, RISC-V,
 * Fedora/Antora docs, Buildroot manual…
 */
export function parseAsciidoc(content: string, opts: ParseOptions): ParsedPage {
  const { path, sourceUrl } = opts;
  const minCode = opts.minCodeChars ?? 12;
  const maxChunk = opts.maxChunkChars ?? 1400;

  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const codeSnippets: ParsedPage["codeSnippets"] = [];
  const infoSnippets: ParsedPage["infoSnippets"] = [];
  const seenHashes = new Set<string>();

  const stack: { depth: number; text: string }[] = [];
  let pageTitle: string | null = null;
  let pendingDesc: string | null = null;
  let pendingLang: string | null = null;
  let prose: string[] = [];
  let proseLen = 0;

  const pageTitleText = () => pageTitle ?? humanize(path);
  const breadcrumb = () => (stack.length ? stack.map((s) => s.text).join(" > ") : null);

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

  let inBlock: string | null = null;
  let blockBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    // ── inside a delimited block ──
    if (inBlock) {
      if (line === inBlock) {
        addCode(blockBuf.join("\n"), pendingLang);
        blockBuf = [];
        inBlock = null;
        pendingLang = null;
      } else {
        blockBuf.push(raw.replace(/\s+$/, ""));
      }
      continue;
    }

    // ── block openers ──
    if (LITERAL_MARKS.has(line)) {
      inBlock = line;
      blockBuf = [];
      continue;
    }

    // ── attribute lines and comments: skip ──
    if (line.startsWith(":") || line.startsWith("//")) continue;

    // ── [source,lang] before block ──
    const langMatch = line.match(/^\[(?:source[-,\s]*)?["']?([a-zA-Z0-9+#._-]+)?["']?(?:,.*)?\]$/);
    if (langMatch) {
      pendingLang = langMatch[1]?.toLowerCase() ?? null;
      continue;
    }

    // ── headings ──
    const h = line.match(HEADING_RE);
    if (h) {
      const depth = h[1]!.length; // = → h1
      const text = cleanInline(h[2]!);
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
      stack.push({ depth, text });
      if (pageTitle === null && depth === 1) pageTitle = text;
      pendingDesc = null;
      continue;
    }

    // ── admonitions → prose with marker ──
    const adm = line.match(ADMONITION_RE);
    if (adm) {
      addProse(`\n> **${adm[1]}**: ${cleanInline(adm[2] ?? "")}`);
      continue;
    }

    // ── bullet/numbered list items ──
    if (/^(\*+|-\s|\d+\.\s)/.test(line)) {
      addProse("- " + cleanInline(line.replace(/^(\*+|\d+\.|-)\s*/, "")));
      continue;
    }

    // ── table markers skip ──
    if (line === "|===") continue;
    if (line.startsWith("|")) {
      addProse(cleanInline(line.replace(/^\|/, "")));
      continue;
    }

    if (line === "") continue;

    // ── normal prose ──
    const cleaned = cleanInline(line);
    if (!cleaned) continue;
    if (cleaned.length <= 400) pendingDesc = cleaned;
    addProse(cleaned);
  }

  flushProse();

  function addProse(text: string) {
    if (!text.trim()) return;
    prose.push(text.trim());
    proseLen += text.length;
    if (proseLen >= maxChunk) flushProse();
  }

  return {
    path,
    title: pageTitleText(),
    sourceUrl: sourceUrl ?? null,
    codeSnippets,
    infoSnippets,
  };
}
