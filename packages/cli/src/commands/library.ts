import pc from "picocolors";
import { ApiError, searchLibraries } from "../apiClient.js";

export async function cmdLibrary(name: string, query: string, opts: { json?: boolean }) {
  const res = await searchLibraries(name, query);
  if (opts.json) {
    console.log(JSON.stringify(res.results, null, 2));
    return;
  }
  if (res.results.length === 0) {
    console.log(pc.yellow(`No se encontraron librerías para "${name}".`));
    console.log(pc.dim(`Añádela con: ctx7max add <url>`));
    return;
  }
  console.log(pc.bold(`\n${res.results.length} resultados para "${name}":\n`));
  for (const [i, r] of res.results.entries()) {
    const idx = pc.dim(`[${i + 1}]`);
    const id = pc.cyan(r.id);
    const state = r.indexed
      ? pc.green("indexada")
      : pc.yellow("catálogo (se indexa al primer uso)");
    console.log(`${idx} ${pc.bold(r.title)} ${id} — ${state}`);
    console.log(
      pc.dim(
        `   snippets: ${r.totalSnippets} · trust: ${r.trustScore} · benchmark: ${r.benchmarkScore} · ★${r.stars}` +
          (r.versions.length ? ` · versiones: ${r.versions.slice(0, 3).join(", ")}` : ""),
      ),
    );
    if (r.description) console.log(pc.dim(`   ${r.description.slice(0, 110)}`));
    console.log();
  }
  const best = res.results[0]!;
  console.log(pc.dim(`Siguiente paso: ctx7max docs ${best.id} "${query}"`));
}

export function wrapCmd<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error(pc.red(`✖ ${err.status} ${err.code}: ${err.message}`));
      } else {
        console.error(pc.red(`✖ ${(err as Error).message}`));
      }
      process.exitCode = 1;
    }
  };
}
