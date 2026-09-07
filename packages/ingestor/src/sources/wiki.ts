import type { DocFile, IngestSourceResult } from "@ctx7max/core";
import { fetchText, sleep } from "../util.js";

const MAX_PAGES = 250;
const BATCH = 20;

interface MwCategoryMembers {
  query: { categorymembers: { title: string }[] };
}

interface MwExtracts {
  query: { pages: Record<string, { title: string; extract?: string }> };
}

/**
 * MediaWiki source (ArchWiki, OSDev, Gentoo…): pulls page extracts via the
 * official API with polite rate limiting. URL form:
 *   https://wiki.archlinux.org            → seeds from a curated default list
 *   https://wiki.archlinux.org#Category:Virtualization
 */
export async function fetchWikiSource(url: string): Promise<IngestSourceResult> {
  const [base, category] = url.split("#");
  const origin = new URL(base!).origin;
  const api = `${origin}/api.php`;
  const host = new URL(origin).hostname.replace(/^www\./, "");

  let pageTitles: string[] = [];
  if (category) {
    const catUrl =
      `${api}?action=query&list=categorymembers&format=json&cmlimit=${MAX_PAGES}` +
      `&cmtitle=${encodeURIComponent(category)}`;
    const data = JSON.parse(await fetchText(catUrl)) as MwCategoryMembers;
    pageTitles = (data.query?.categorymembers ?? []).map((m) => m.title);
  } else {
    // default: top pages by relevance — use allpages limited, best-effort
    const allUrl = `${api}?action=query&list=allpages&format=json&aplimit=${MAX_PAGES}`;
    const data = JSON.parse(await fetchText(allUrl)) as {
      query: { allpages: { title: string }[] };
    };
    pageTitles = (data.query?.allpages ?? []).map((m) => m.title);
  }

  if (pageTitles.length === 0) {
    throw new Error(`No pages found in wiki ${origin} (${category ?? "all"})`);
  }

  const files: DocFile[] = [];
  for (let i = 0; i < pageTitles.length && files.length < MAX_PAGES; i += BATCH) {
    const titles = pageTitles.slice(i, i + BATCH);
    const extractUrl =
      `${api}?action=query&prop=extracts&explaintext=1&format=json` +
      `&titles=${encodeURIComponent(titles.join("|"))}`;
    try {
      const data = JSON.parse(await fetchText(extractUrl)) as MwExtracts;
      for (const page of Object.values(data.query?.pages ?? {})) {
        const text = page.extract?.trim() ?? "";
        if (text.length < 250) continue;
        files.push({
          path: `wiki/${page.title.replace(/[^\w\-]+/g, "_").slice(0, 80)}.txt`,
          content: `# ${page.title}\n\n${text}`,
          sourceUrl: `${origin}/title/${encodeURIComponent(page.title)}`,
        });
      }
    } catch {
      /* skip failed batch */
    }
    await sleep(1500); // polite with public wikis
  }

  if (files.length === 0) throw new Error(`Extracted 0 pages from ${origin}`);

  return {
    libraryId: `/wiki/${host.replace(/\./g, "-")}${category ? "--" + category.replace(/^Category:/, "").replace(/[^\w-]+/g, "-") : ""}`,
    title: `${host}${category ? ` — ${category.replace("Category:", "")}` : ""}`,
    description: `Wiki documentation from ${origin}`,
    sourceType: "website",
    sourceUrl: url,
    branch: null,
    repoSha: null,
    license: null,
    stars: 0,
    versions: [],
    files,
    rules: [],
    settings: { maxSnippets: 0, includeExamples: false },
  };
}
