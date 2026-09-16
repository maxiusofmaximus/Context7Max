import {
  createDb,
  createJob,
  embedSmart,
  getRowsWithoutEmbedding,
  updateJob,
  upsertEmbeddings,
  upsertGuides,
  upsertMcpServers,
  upsertSkills,
  countTokens,
  deleteGuidesBySource,
  hashContent,
  type DbEnv,
  type GuideRow,
} from "@ctx7max/core";
import { sleep } from "./util.js";
import { GUIDE_FETCHERS, type GuideSourceName, GUIDE_SOURCES } from "./sources/guides.js";
import {
  fetchGitHubSkillRepos,
  fetchSkillsSh,
  fetchUiSkills,
  toSkillRow,
} from "./sources/skills.js";
import { fetchOfficialMcpRegistry, fetchSmitheryRegistry } from "./sources/mcps.js";

export interface KnowledgeIngestOptions {
  env: DbEnv;
  embed?: boolean;
  githubToken?: string;
  onLog?: (msg: string) => void;
}

function guideEmbedText(g: Omit<GuideRow, "id" | "embedding">): string {
  return [g.domain, g.track, g.title, g.body.slice(0, 900)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1400)
    .trim();
}

export async function ingestGuides(
  source: GuideSourceName,
  opts: KnowledgeIngestOptions,
): Promise<{ source: string; guides: number; tokens: number }> {
  const log = opts.onLog ?? (() => {});
  const db = createDb(opts.env);
  const doEmbed = opts.embed !== false;

  const jobId = await createJob(db, {
    library_id: `guides/${source}`,
    action: "ingest",
    status: "running",
    stage: "fetching",
    message: `knowledge source: ${source}`,
    stats: {},
    actor: "cli",
  });

  try {
    const fetcher = GUIDE_FETCHERS[source];
    const drafts = await fetcher(opts.githubToken);
    log(`  ${source}: ${drafts.length} guías extraídas`);

    const seen = new Set<string>();
    const rows: Omit<GuideRow, "id">[] = [];
    for (const d of drafts) {
      const hash = hashContent(d.body);
      const dedupKey = `${d.source}|${d.domain}|${d.track ?? ""}|${d.node_id ?? ""}|${hash}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      rows.push({
        ...d,
        tokens: countTokens(d.body),
        content_hash: hash,
      });
    }

    await deleteGuidesBySource(db, source); // refresh limpio del source

    // procesado por lotes: el progreso persiste aunque se interrumpa
    const CHUNK = 300;
    let processed = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      if (doEmbed) {
        const vecs = await embedSmart(opts.env, chunk.map(guideEmbedText));
        chunk.forEach((r, j) => {
          r.embedding = vecs[j] ?? null;
        });
      }
      await upsertGuides(db, chunk);
      processed += chunk.length;
      await updateJob(db, jobId, {
        stage: "embedding",
        message: `${processed}/${rows.length} guides`,
      });
      log(`  ${processed}/${rows.length}`);
    }

    const totalTokens = rows.reduce((a, r) => a + r.tokens, 0);
    await updateJob(db, jobId, {
      status: "done",
      stage: "finalized",
      message: `${processed} guides`,
      stats: { guides: rows.length, tokens: totalTokens },
    });
    return { source, guides: rows.length, tokens: totalTokens };
  } catch (err) {
    await updateJob(db, jobId, {
      status: "failed",
      message: (err as Error).message.slice(0, 400),
    }).catch(() => {});
    throw err;
  }
}

export async function ingestSkills(opts: KnowledgeIngestOptions): Promise<{ total: number }> {
  const log = opts.onLog ?? (() => {});
  const db = createDb(opts.env);
  const doEmbed = opts.embed !== false;

  log("  skills: ui-skills registry…");
  const ui = await fetchUiSkills().catch((e) => {
    log(`  ui-skills failed: ${(e as Error).message}`);
    return [];
  });
  log(`  ${ui.length} from ui-skills`);

  log("  skills: GitHub repos (anthropics, mattpocock, …)…");
  const gh = await fetchGitHubSkillRepos(opts.githubToken);
  log(`  ${gh.length} from GitHub repos`);

  log("  skills: skills.sh leaderboard…");
  const sh = await fetchSkillsSh().catch(() => []);
  log(`  ${sh.length} from skills.sh`);

  const rows = [...ui, ...gh, ...sh].map(toSkillRow);
  if (doEmbed) {
    const vecs = await embedSmart(
      opts.env,
      rows.map((r) => [r.name, r.description, r.body.slice(0, 700)].filter(Boolean).join("\n").slice(0, 1200)),
    );
    rows.forEach((r, i) => {
      r.embedding = vecs[i] ?? null;
    });
  }
  await upsertSkills(db, rows);
  return { total: rows.length };
}

export async function ingestMcpServers(opts: KnowledgeIngestOptions): Promise<{ total: number }> {
  const log = opts.onLog ?? (() => {});
  const db = createDb(opts.env);

  log("  MCP registry oficial…");
  const official = await fetchOfficialMcpRegistry().catch(() => []);
  log(`  ${official.length} servidores (modelcontextprotocol)`);

  log("  Smithery…");
  const smithery = await fetchSmitheryRegistry().catch(() => []);
  log(`  ${smithery.length} servidores (smithery)`);

  const seen = new Set<string>();
  const rows = [...official, ...smithery].filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
  await upsertMcpServers(db, rows);
  return { total: rows.length };
}

export { GUIDE_SOURCES };

// ── Reembed: recupera filas que quedaron sin vector ─────────────────

const REEMBED_TABLES = ["code_snippets", "info_snippets", "guides", "skills"] as const;
const REEMBED_PAGE = 160;
const REEMBED_BATCH = 4;

export interface ReembedStats {
  table: string;
  updated: number;
  failed: number;
}

/** LLamada paciente a la Edge Function: 4 textos, hasta 4 reintentos. */
async function embedBatchPatient(
  env: DbEnv,
  texts: string[],
): Promise<(number[] | null)[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${env.supabaseUrl}/functions/v1/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.serviceRoleKey}`,
        },
        body: JSON.stringify({ inputs: texts }),
      });
      if (!res.ok) throw new Error(`embed ${res.status}`);
      const data = (await res.json()) as { embeddings: number[][] };
      if (Array.isArray(data.embeddings)) return data.embeddings;
    } catch {
      // reintenta
    }
    await sleep(1500 * (attempt + 1));
  }
  return texts.map(() => null);
}

/**
 * Re-vectoriza filas con embedding NULL. Secuencial, paciente y CON cooldown
 * entre lotes: la Edge Function comparte CPU en el free tier; el paralelismo
 * la satura y deja huecos.
 */
export async function reembedMissing(
  opts: KnowledgeIngestOptions,
): Promise<ReembedStats[]> {
  const db = createDb(opts.env);
  const log = opts.onLog ?? (() => {});
  const stats: ReembedStats[] = [];

  for (const table of REEMBED_TABLES) {
    let updated = 0;
    let failed = 0;
    let consecutiveEmpty = 0;
    for (let round = 0; round < 400; round++) {
      const rows = await getRowsWithoutEmbedding(db, table, REEMBED_PAGE);
      if (rows.length === 0) break;

      for (let i = 0; i < rows.length; i += REEMBED_BATCH) {
        const slice = rows.slice(i, i + REEMBED_BATCH);
        const vecs = await embedBatchPatient(
          opts.env,
          slice.map((r) => r.body),
        );
        const updates = slice
          .map((r, j) => ({ id: r.id, embedding: vecs[j] }))
          .filter((u): u is { id: string | number; embedding: number[] } => !!u.embedding);
        if (updates.length === 0) {
          failed += slice.length;
          consecutiveEmpty++;
          if (consecutiveEmpty >= 5) {
            log(`  ${table}: edge saturada 5 lotes seguidos — pausa 60s`);
            await sleep(60_000);
            consecutiveEmpty = 0;
          }
          continue;
        }
        consecutiveEmpty = 0;
        failed -= 0;
        await upsertEmbeddings(db, table, updates);
        updated += updates.length;
        await sleep(500); // cooldown entre lotes
      }
      if (updated % 800 < REEMBED_PAGE) {
        log(`  ${table}: ${updated} re-vectorizadas…`);
      }
    }
    stats.push({ table, updated, failed });
  }
  return stats;
}

export { REEMBED_TABLES };
