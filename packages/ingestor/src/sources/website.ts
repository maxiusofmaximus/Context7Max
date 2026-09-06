import type { DocFile, IngestSourceResult } from "@ctx7max/core";
import { hashContent } from "@ctx7max/core";
import { fetchText, pool } from "../util.js";
import { htmlToMarkdown, isAllowedByRobots } from "../html.js";

const MAX_PAGES = 200;
const MIN_PAGES = 3;

/** doc-ish path prefixes get priority when trimming the sitemap */
const DOCISH = ["/docs", "/guide", "/guides", "/documentation", "/reference", "/api", "/learn", "/manual", "/handbook", "/tutorials", "/wiki"];

async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const sm of candidates) {
    try {
      const xml = await fetchText(sm);
      // sitemap index → nested sitemaps
      const nested = [...xml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
      if (nested.length > 0) {
        const urls: string[] = [];
        for (const loc of nested.slice(0, 10)) {
          try {
            const sub = await fetchText(loc);
            urls.push(...[...sub.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
            if (urls.length >= MAX_PAGES * 3) break;
          } catch { /* skip broken sub-sitemap */ }
        }
        return urls;
      }
      return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    } catch { /* try next candidate */ }
  }
  return [];
}

function pickDocUrls(urls: string[], origin: string): string[] {
  const sameHost = urls.filter((u) => u.startsWith(origin));
  const docUrls = sameHost.filter((u) =>
    DOCISH.some((p) => new URL(u).pathname.startsWith(p)),
  );
  const list = docUrls.length >= MIN_PAGES ? docUrls : sameHost;
  return [...new Set(list)].slice(0, MAX_PAGES);
}

/** Extract <title>-ish slug and check for llms.txt first (cheapest & cleanest). */
async function tryLlmsTxt(origin: string): Promise<DocFile[] | null> {
  for (const name of ["llms-full.txt", "llms.txt"]) {
    try {
      const res = await fetchText(`${origin}/${name}`);
      if (!res || res.length < 200 || /<html/i.test(res.slice(0, 400))) continue;
      if (name === "llms-full.txt") {
        // full dump: split into pseudo-pages on H1 boundaries
        const sections = res.split(/\n(?=# )/g).filter((s) => s.trim().length > 100);
        return sections.slice(0, 120).map((s, i) => ({
          path: `llms-full/section-${i}.md`,
          content: s.trim(),
          sourceUrl: `${origin}/${name}`,
        }));
      }
      // llms.txt = index of links → fetch each linked .md
      const links = [...res.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)];
      const mdLinks = links
        .map((m) => ({ title: m[1]!, url: m[2]! }))
        .filter((l) => /\.md(x)?($|[?#])/.test(l.url) || l.url.startsWith("/"))
        .slice(0, 80);
      const files: DocFile[] = [];
      await pool(mdLinks, 4, async (link) => {
        const url = link.url.startsWith("http") ? link.url : `${origin}${link.url}`;
        try {
          const txt = await fetchText(url);
          if (txt.trim().length < 100) return null;
          files.push({
            path: `llms/${link.title.replace(/[^\w\-]+/g, "_").slice(0, 60)}.md`,
            content: txt,
            sourceUrl: url,
          });
        } catch { /* skip */ }
        return null;
      });
      return files.length > 0 ? files : null;
    } catch { /* not present */ }
  }
  return null;
}

export async function fetchWebsiteSource(url: string): Promise<IngestSourceResult> {
  const origin = new URL(url).origin;
  const titleGuess = new URL(origin).hostname.replace(/^www\./, "");

  // 1) llms.txt cascade (cheapest, cleanest)
  let files: DocFile[] | null = null;
  try {
    files = await tryLlmsTxt(origin);
  } catch { /* fall through to crawl */ }

  // 2) sitemap crawl + readability
  if (!files || files.length < MIN_PAGES) {
    const robotsCache = new Map<string, string | null>();
    const sitemapUrls = pickDocUrls(await fetchSitemapUrls(origin), origin);
    if (sitemapUrls.length === 0) {
      throw new Error(`No sitemap/llms.txt found for ${origin}`);
    }
    const crawled: DocFile[] = [];
    await pool(sitemapUrls, 4, async (pageUrl) => {
      if (!(await isAllowedByRobots(origin, pageUrl, robotsCache, fetchText)))
        return null;
      try {
        const html = await fetchText(pageUrl);
        const md = htmlToMarkdown(html, pageUrl);
        if (!md) return null;
        crawled.push({
          path: new URL(pageUrl).pathname.replace(/\/$/, "") + ".md" === "/.md"
            ? "/index.md"
            : new URL(pageUrl).pathname.replace(/\/$/, "") + ".md",
          content: `# ${md.title}\n\n${md.markdown}`,
          sourceUrl: pageUrl,
        });
      } catch { /* page failed — skip */ }
      return null;
    });
    if (crawled.length < MIN_PAGES) {
      throw new Error(
        `Crawl quality gate: only ${crawled.length} usable pages at ${origin} ` +
          `(need >= ${MIN_PAGES}). Check the site publishes static docs or an llms.txt.`,
      );
    }
    files = crawled;
  }

  return {
    libraryId: `/websites/${titleGuess.replace(/\./g, "-")}`,
    title: titleGuess,
    description: `Documentation crawled from ${origin}`,
    sourceType: "website",
    sourceUrl: origin,
    branch: null,
    repoSha: hashContent(files.map((f) => f.content).join()).slice(0, 12),
    license: null,
    stars: 0,
    versions: [],
    files,
    rules: [],
    settings: {},
  };
}
