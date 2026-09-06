/**
 * Context7Max worker — runs inside GitHub Actions (or locally).
 *
 * Modes:
 *   queue    → consume pending ingestion jobs from Supabase (default)
 *   refresh  → re-ingest libraries not updated in >7 days
 *   url X    → ingest a specific URL now
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN (optional)
 */
import { createDb, type DbEnv } from "@ctx7max/core";
import { ingestSource } from "@ctx7max/ingestor";

const env: DbEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
if (!env.supabaseUrl || !env.serviceRoleKey) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const mode = process.argv[2] ?? "queue";
const githubToken = process.env.GITHUB_TOKEN;
const db = createDb(env);

async function ingestOne(url: string, actor: "action" | "cron") {
  console.log(`\n═══ ingest: ${url}`);
  try {
    const res = await ingestSource(url, {
      env,
      type: "auto",
      actor,
      githubToken,
      onLog: (m) => console.log(`  → ${m}`),
    });
    console.log(`  ✓ ${res.libraryId}: ${res.codeSnippets} snippets (${res.totalTokens} tok)`);
  } catch (err) {
    console.error(`  ✖ falló ${url}: ${(err as Error).message}`);
  }
}

if (mode === "queue") {
  const { data: jobs, error } = await db
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) throw error;
  if (!jobs.length) {
    console.log("No queued jobs. Bye.");
    process.exit(0);
  }
  for (const job of jobs) {
    await db
      .from("jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    const url = job.message as string;
    try {
      const res = await ingestSource(url, {
        env,
        type: "auto",
        actor: job.actor === "api" ? "api" : "action",
        githubToken,
        onLog: (m) => console.log(`  → ${m}`),
      });
      await db
        .from("jobs")
        .update({
          status: "done",
          stage: "finalized",
          stats: res as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    } catch (err) {
      await db
        .from("jobs")
        .update({
          status: "failed",
          message: (err as Error).message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }
} else if (mode === "refresh") {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: libs, error } = await db
    .from("libraries")
    .select("id, source_url")
    .eq("state", "finalized")
    .lt("last_update_at", cutoff)
    .limit(10);
  if (error) throw error;
  console.log(`Refreshing ${libs?.length ?? 0} stale libraries`);
  for (const lib of libs ?? []) {
    await ingestOne(lib.source_url as string, "cron");
  }
} else if (mode === "url") {
  const url = process.argv[3];
  if (!url) throw new Error("usage: worker.mts url <url>");
  await ingestOne(url, "action");
}

console.log("\nworker done.");
