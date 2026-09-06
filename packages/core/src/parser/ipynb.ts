import { countTokens } from "../tokens.js";
import { hashContent } from "../hash.js";
import type { ParsedPage } from "../types.js";
import type { ParseOptions } from "./markdown.js";
import { parseMarkdown } from "./markdown.js";

interface NotebookCell {
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  metadata?: Record<string, unknown>;
}

interface Notebook {
  cells: NotebookCell[];
  metadata?: {
    kernelspec?: { language?: string };
    language_info?: { name?: string };
  };
}

/** Parse a Jupyter notebook: markdown cells → md parser, code cells → snippets. */
export function parseIpynb(content: string, opts: ParseOptions): ParsedPage {
  const { path, sourceUrl } = opts;
  let nb: Notebook;
  try {
    nb = JSON.parse(content) as Notebook;
  } catch {
    return { path, title: "Notebook", sourceUrl: sourceUrl ?? null, codeSnippets: [], infoSnippets: [] };
  }

  const lang =
    nb.metadata?.kernelspec?.language ??
    nb.metadata?.language_info?.name ??
    "python";

  const codeSnippets: ParsedPage["codeSnippets"] = [];
  const infoSnippets: ParsedPage["infoSnippets"] = [];
  let pageTitle: string | null = null;
  let lastHeading: string | null = null;

  for (const cell of nb.cells ?? []) {
    const src = Array.isArray(cell.source) ? cell.source.join("") : cell.source ?? "";
    if (!src.trim()) continue;

    if (cell.cell_type === "markdown") {
      const parsed = parseMarkdown(src, { path, sourceUrl });
      if (!pageTitle && parsed.title !== "Overview" && parsed.title !== "Introduction") {
        pageTitle = parsed.title;
      }
      const lastInfo = parsed.infoSnippets[parsed.infoSnippets.length - 1];
      if (lastInfo?.breadcrumb) lastHeading = lastInfo.breadcrumb;
      codeSnippets.push(...parsed.codeSnippets);
      infoSnippets.push(...parsed.infoSnippets);
    } else if (cell.cell_type === "code") {
      const code = src.trim();
      if (code.length < (opts.minCodeChars ?? 12)) continue;
      const hash = hashContent(code);
      if (codeSnippets.some((s) => s.content_hash === hash)) continue;
      codeSnippets.push({
        title: lastHeading ?? pageTitle ?? "Notebook example",
        description: null,
        language: lang,
        code,
        tokens: countTokens(code),
        source_url: sourceUrl ?? null,
        source_file: path,
        line_start: null,
        line_end: null,
        breadcrumb: lastHeading,
        content_hash: hash,
      });
    }
  }

  return {
    path,
    title: pageTitle ?? "Notebook",
    sourceUrl: sourceUrl ?? null,
    codeSnippets,
    infoSnippets,
  };
}
