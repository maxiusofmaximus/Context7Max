/**
 * Audita los 20 repos de Jev listados por Charlie Hills: cuántos .md tienen
 * (valor como librería), si hay SKILL.md (valor como skill), estrellas.
 */
const REPOS = [
  "browser-use/jev-ultrafast", "tamaratran/fast-jev-compaction", "vercel-labs/json-render",
  "itsmostafa/typesafe-mcp", "jkudish/jev-mcp", "sharziki/semdecide", "0xNatoshi/jev-codex-router",
  "GhalebDweikat/winnow", "devagrawal09/jev-review", "ellipsis-dev/blink", "lahfir/agent-desktop",
  "fhshaik/typesafe-mario", "RomanSlack/jev-drone", "emrickgarrett/OneVOneJev",
  "jarrodwatts/jev-trader", "irfndi/prism-liquidity-agent", "jexp/neo4jev",
  "AkashPriyadarshii/jev-curate", "qkal/Canny", "monteduro/killmyidea",
];

const token = process.env.GITHUB_TOKEN;
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ctx7max-audit",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

for (const repo of REPOS) {
  try {
    const meta = await fetch(`https://api.github.com/repos/${repo}`, { headers }).then((r) =>
      r.ok ? r.json() : null,
    ) as { stargazers_count?: number; description?: string; default_branch?: string } | null;
    if (!meta) {
      console.log(`${repo}|ERROR`);
      continue;
    }
    const branch = meta.default_branch ?? "main";
    const tree = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
      { headers },
    ).then((r) => (r.ok ? r.json() : null)) as { tree?: { path: string }[] } | null;
    const paths = (tree?.tree ?? []).map((x) => x.path);
    const md = paths.filter((p) => /\.md$/i.test(p)).length;
    const skills = paths.filter((p) => p.endsWith("SKILL.md")).length;
    console.log(
      `${repo} | ★${meta.stargazers_count ?? 0} | .md=${md} skills=${skills} | ${(meta.description ?? "").slice(0, 90)}`,
    );
  } catch (err) {
    console.log(`${repo} | ERROR: ${(err as Error).message}`);
  }
}
