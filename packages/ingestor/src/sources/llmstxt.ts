import type { DocFile, IngestSourceResult } from "@ctx7max/core";
import { hashContent } from "@ctx7max/core";
import { fetchText, pool } from "../util.js";

const MAX_PAGES = 120;

/**
 * Ingest an llms.txt / llms-full.txt source.
 * llms.txt = an LLM-friendly index of markdown links (H1 title + links).
 */
export async function fetchLlmsTxtSource(url: string): Promise<IngestSourceResult> {
  const body = await fetchText(url);
  if (body.trim().length < 100) throw new Error(`Empty or invalid llms.txt at ${url}`);

  const origin = new URL(url).origin;
  const isFull = url.endsWith("llms-full.txt");
  const files: DocFile[] = [];

  if (isFull) {
    const sections = body.split(/\n(?=# )/g).filter((s) => s.trim().length > 100);
    sections.slice(0, MAX_PAGES).forEach((s, i) => {
      files.push({
        path: `llms-full/section-${i}.md`,
        content: s.trim(),
        sourceUrl: url,
      });
    });
  } else {
    // index file: H1 + link list → fetch each markdown page
    const links = [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)]
      .map((m) => ({ title: m[1]!, url: m[2]!.startsWith("http") ? m[2]! : `${origin}${m[2]}` }))
      .filter((l) => !/\.(png|jpe?g|svg|gif|webp|ico|css|js)(\?|$)/i.test(l.url))
      .slice(0, MAX_PAGES);

    const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    await pool(links, 4, async (link) => {
      try {
        const txt = await fetchText(link.url);
        if (txt.trim().length < 100 || /<html/i.test(txt.slice(0, 200))) return null;
        files.push({
          path: `llms/${link.title.replace(/[^\w\-]+/g, "_").slice(0, 60)}.md`,
          content: txt,
          sourceUrl: link.url,
        });
      } catch { /* skip dead links */ }
      return null;
    });
    if (files.length === 0) {
      // index had no reachable pages → still index the index itself
      files.push({ path: "llms.txt.md", content: body, sourceUrl: url });
    } else if (title) {
      // keep the index too — it carries the section structure
      files.unshift({ path: "llms-index.md", content: body, sourceUrl: url });
    }
  }

  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const slug = new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "-");

  return {
    libraryId: `/llmstxt/${slug}`,
    title: h1 ?? slug,
    description: `llms.txt documentation from ${origin}`,
    sourceType: "llmstxt",
    sourceUrl: url,
    branch: null,
    repoSha: hashContent(body).slice(0, 12),
    license: null,
    stars: 0,
    versions: [],
    files,
    rules: [],
    settings: {},
  };
}
