import type { DocFile, ParsedPage } from "../types.js";
import { parseMarkdown, stripMdx, type ParseOptions } from "./markdown.js";
import { parseRst } from "./rst.js";
import { parseIpynb } from "./ipynb.js";
import { parseAsciidoc } from "./asciidoc.js";
import { countTokens } from "../tokens.js";
import { hashContent } from "../hash.js";

export { parseMarkdown, stripMdx, parseRst, parseIpynb, parseAsciidoc };

/** Parse any supported doc file into snippets. */
export function parseDocument(file: DocFile, opts?: Partial<ParseOptions>): ParsedPage {
  const ext = file.path.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? "";
  const options: ParseOptions = {
    path: file.path,
    sourceUrl: file.sourceUrl,
    ...opts,
  };
  switch (ext) {
    case ".rst":
      return parseRst(file.content, options);
    case ".ipynb":
      return parseIpynb(file.content, options);
    case ".adoc":
    case ".asciidoc":
      return parseAsciidoc(file.content, options);
    case ".txt":
      return parsePlainText(file.content, options);
    default:
      return parseMarkdown(file.content, options);
  }
}

/** Plain text: chunk into info snippets, no code extraction. */
function parsePlainText(content: string, opts: ParseOptions): ParsedPage {
  const maxChunk = opts.maxChunkChars ?? 1400;
  const infoSnippets: ParsedPage["infoSnippets"] = [];
  const paras = content.split(/\n{2,}/);
  let buf: string[] = [];
  let len = 0;
  const flush = () => {
    const text = buf.join("\n\n").trim();
    buf = [];
    len = 0;
    if (text.length < 80) return;
    infoSnippets.push({
      page_title: opts.path.split("/").pop() ?? opts.path,
      breadcrumb: null,
      content: text,
      tokens: countTokens(text),
      source_url: opts.sourceUrl ?? null,
      source_file: opts.path,
      content_hash: hashContent(text),
    });
  };
  for (const p of paras) {
    buf.push(p);
    len += p.length;
    if (len >= maxChunk) flush();
  }
  flush();
  return {
    path: opts.path,
    title: opts.path.split("/").pop() ?? opts.path,
    sourceUrl: opts.sourceUrl ?? null,
    codeSnippets: [],
    infoSnippets,
  };
}
