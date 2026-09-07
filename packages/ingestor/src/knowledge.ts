import {
  createDb,
  createJob,
  embedTexts,
  updateJob,
  upsertGuides,
  upsertMcpServers,
  upsertSkills,
  countTokens,
  deleteGuidesBySource,
  hashContent,
  type DbEnv,
  type GuideRow,
} from "@ctx7max/core";
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
        const vecs = await embedTexts(opts.env, chunk.map(guideEmbedText));
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
    const vecs = await embedTexts(
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
