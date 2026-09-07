import { GUIDE_FETCHERS } from "@ctx7max/ingestor";

const source = (process.argv[2] ?? "roadmap.sh") as keyof typeof GUIDE_FETCHERS;
console.log(`→ fetching guides from ${source}`);
const t0 = Date.now();
const guides = await GUIDE_FETCHERS[source]();
console.log(`✓ ${guides.length} guías en ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const byDomain = new Map<string, number>();
for (const g of guides) byDomain.set(g.domain, (byDomain.get(g.domain) ?? 0) + 1);
console.log(
  "dominios:",
  [...byDomain.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join(", "),
);

console.log("\nMuestras:");
for (const g of guides.slice(0, 3)) {
  console.log(`— [${g.domain}/${g.track}] ${g.title}`);
  console.log(`  body: ${g.body.slice(0, 140).replace(/\n+/g, " ")}…`);
  console.log(`  links: ${g.links.slice(0, 2).map((l) => `${l.type}:${l.url}`).join(" · ")}`);
}

// Para escribir a la base de datos (con embeddings): pnpm tsx scripts/ingest-guides.mts <source>
