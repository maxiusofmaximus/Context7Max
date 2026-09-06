import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "_",
    });
    // never prune code: keep <pre> verbatim-ish
    turndown.keep(["pre"]);
    turndown.addRule("fencedCode", {
      filter: (node) => node.nodeName === "PRE",
      replacement: (_content, node) => {
        const el = node as unknown as {
          querySelector: (s: string) => { textContent: string | null; className?: string } | null;
          textContent: string | null;
        };
        const code = el.querySelector("code");
        const lang =
          code?.className?.match(/language-([\w-]+)/)?.[1] ?? "";
        const text = (code?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      },
    });
    turndown.remove(["script", "style", "noscript", "iframe"]);
  }
  return turndown;
}

/**
 * HTML → clean markdown. Extracts the main content area (Readability),
 * then converts with Turndown. Returns null when no readable content found.
 */
export function htmlToMarkdown(
  html: string,
  url: string,
): { title: string; markdown: string } | null {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const article = new Readability(doc, { charThreshold: 200 }).parse();
  const contentHtml = article?.content ?? doc.body?.innerHTML ?? "";
  const title =
    article?.title ?? doc.querySelector("title")?.textContent?.trim() ?? null;

  if (!contentHtml || contentHtml.trim().length < 100) return null;

  const markdown = getTurndown().turndown(contentHtml).trim();
  const codeChars = (markdown.match(/```/g)?.length ?? 0);
  const linkDensity =
    (markdown.match(/\]\(/g)?.length ?? 0) / Math.max(markdown.length / 300, 1);
  // low-signal pages: barely any text or pure link-lists
  if (markdown.length < 250) return null;
  if (linkDensity > 0.55 && codeChars === 0) return null;

  return { title: title ?? "Untitled", markdown };
}

/** robots.txt: is `url`'s path allowed for our bot? (simple parser) */
export async function isAllowedByRobots(
  origin: string,
  url: string,
  robotsCache: Map<string, string | null>,
  fetchTxt: (u: string) => Promise<string>,
): Promise<boolean> {
  if (!robotsCache.has(origin)) {
    try {
      robotsCache.set(origin, await fetchTxt(`${origin}/robots.txt`));
    } catch {
      robotsCache.set(origin, null);
    }
  }
  const robots = robotsCache.get(origin);
  if (!robots) return true;
  const path = new URL(url).pathname;
  let inAnyGroup = false;
  for (const rawLine of robots.split("\n")) {
    const line = rawLine.trim();
    if (/^user-agent:\s*\*/i.test(line)) inAnyGroup = true;
    else if (/^user-agent:/i.test(line) && !/\*/i.test(line)) inAnyGroup = false;
    if (!inAnyGroup) continue;
    const m = line.match(/^disallow:\s*(\S+)/i);
    if (m && m[1] !== "/" && path.startsWith(m[1])) return false;
    if (m && m[1] === "/") return false;
  }
  return true;
}
