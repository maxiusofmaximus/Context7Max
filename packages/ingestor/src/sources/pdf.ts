import {
  countTokens,
  hashContent,
  type DocFile,
  type IngestSourceResult,
} from "@ctx7max/core";
import { fetchBytes } from "../util.js";

/**
 * PDF source: extracts text from public PDFs (datasheets, specs, libros
 * libres como OSTEP/LDD3) and splits it into page-range pseudo-pages so the
 * standard parser can build info snippets. Code extraction from PDFs is
 * inherently lossy — we favor prose; fenced blocks rarely survive.
 */
export async function fetchPdfSource(url: string): Promise<IngestSourceResult> {
  const bytes = await fetchBytes(url, { timeoutMs: 90_000 });

  // pdf-parse v2: class-based API over pdfjs-dist
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  let fullText: string;
  let numPages = 0;
  try {
    const result = await parser.getText();
    fullText = (result.text ?? "").replace(/\r\n/g, "\n");
    numPages = result.total ?? 0;
  } finally {
    await parser.destroy().catch(() => {});
  }
  if (fullText.trim().length < 500) {
    throw new Error(`PDF at ${url} has no extractable text (scanned/encrypted?)`);
  }

  // split in chunks of ~4.000 chars on page/section boundaries
  const chunks: string[] = [];
  let buf = "";
  for (const line of fullText.split("\n")) {
    buf += line + "\n";
    const looksLikeBoundary =
      /^\s*\d+(\.\d+)*\s+[A-ZÁÉÍÓÚÑ]/.test(line) || // "3. System Calls"
      /^\s*Chapter\s+\d+/i.test(line);
    if (buf.length >= 4000 && looksLikeBoundary) {
      chunks.push(buf);
      buf = "";
    }
    if (buf.length >= 8000) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) chunks.push(buf);

  const MAX_CHUNKS = 120;
  const files: DocFile[] = chunks.slice(0, MAX_CHUNKS).map((chunk, i) => ({
    path: `pdf/part-${String(i + 1).padStart(3, "0")}.txt`,
    content: chunk.trim(),
    sourceUrl: url,
  }));

  const name = url.split("/").pop()?.replace(/\.pdf$/i, "") ?? "document";
  return {
    libraryId: `/pdf/${name.replace(/[^\w.-]+/g, "-").toLowerCase()}`,
    title: name.replace(/[-_]+/g, " "),
    description: `PDF documentation (${numPages || "?"} pages) from ${new URL(url).hostname}`,
    sourceType: "website",
    sourceUrl: url,
    branch: null,
    repoSha: hashContent(fullText.slice(0, 50_000)).slice(0, 12),
    license: null,
    stars: 0,
    versions: [],
    files,
    rules: [],
    settings: { maxSnippets: 0 },
  };
}
