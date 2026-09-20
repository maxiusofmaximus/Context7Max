import { hashContent, parseDecisionSpec, type DecisionSpec } from "@ctx7max/core";
import { fetchText, pool } from "../util.js";
import { fetchGitHubZipFiles } from "./github.js";

/**
 * Fuentes de specs de decisión (contratos System One) en repos:
 * - constraints/decisions.json (Root)
 * - decisions/*.json
 * - .ctx7max/decisions/**\/*.json
 * - pares skill-sidecar: skills/** /SKILL.md + decisions.json
 */
export async function fetchDecisionSpecsFromGitHub(
  owner: string,
  repo: string,
  token?: string,
): Promise<DecisionSpec[]> {
  const files = await fetchGitHubZipFiles(owner, repo, "main", token).catch(() =>
    fetchGitHubZipFiles(owner, repo, "master", token),
  );
  const out: DecisionSpec[] = [];
  const decoder = new TextDecoder();
  for (const [path, bytes] of files) {
    const isSpecFile =
      /(^|\/)decisions\.json$/.test(path) ||
      /(^|\/)decisions\/[^/]+\.json$/.test(path) ||
      /(^|\/)decision-specs?\/[^/]+\.json$/.test(path) ||
      /\.decision\.json$/.test(path);
    if (!isSpecFile) continue;

    try {
      const raw = JSON.parse(decoder.decode(bytes)) as unknown;
      const items: unknown[] = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        const spec = parseDecisionSpec(item);
        if (!spec) continue;
        out.push({
          ...spec,
          source: "github",
          id: spec.id.includes(":") ? spec.id : `github:${owner}/${repo}/${path}#${spec.id}`,
        });
      }
    } catch {
      /* JSON inválido — ignorar */
    }
  }
  return out;
}

/** Spec files desde URLs directas (lista de URLs de decision JSON). */
export async function fetchDecisionSpecsFromUrls(urls: string[]): Promise<DecisionSpec[]> {
  const out: DecisionSpec[] = [];
  await pool(urls, 4, async (url) => {
    try {
      const text = await fetchText(url);
      const raw = JSON.parse(text) as unknown;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const spec = parseDecisionSpec(item);
        if (!spec) continue;
        out.push({
          ...spec,
          source: "custom",
          id: spec.id.includes(":") ? spec.id : `url:${hashContent(url).slice(0, 8)}#${spec.id}`,
        });
      }
    } catch {
      /* ignora */
    }
    return null;
  });
  return out;
}
