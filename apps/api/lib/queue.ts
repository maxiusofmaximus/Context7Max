import { createJob } from "@ctx7max/core";
import { getSupabase } from "./auth.js";

/**
 * Enqueue an ingestion job and (best-effort) wake the GitHub Action worker
 * via repository_dispatch. If no dispatch token is configured, the hourly
 * scheduled Action picks up queued jobs from the DB.
 */
export async function enqueueIngestion(
  sourceUrl: string,
  actor: "api" | "cli" | "cron",
  opts: { libraryId?: string } = {},
): Promise<{ enqueued: boolean; dispatched: boolean }> {
  const libId = opts.libraryId ?? guessLibraryId(sourceUrl);
  await createJob(getSupabase(), {
    library_id: libId,
    action: "ingest",
    status: "queued",
    stage: null,
    message: sourceUrl,
    stats: {},
    actor,
  });

  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO; // "owner/Context7Max"
  if (!token || !repo) return { enqueued: true, dispatched: false };

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "ctx7max-ingest",
        client_payload: { sourceUrl, libraryId: libId },
      }),
    });
    return { enqueued: true, dispatched: res.ok };
  } catch {
    return { enqueued: true, dispatched: false };
  }
}

export function guessLibraryId(url: string): string {
  const gh = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (gh) return `/${gh[1]}/${gh[2]!.replace(/\.git$/, "")}`;
  try {
    const u = new URL(url);
    if (/llms(-full)?\.txt/i.test(url))
      return `/llmstxt/${u.hostname.replace(/^www\./, "").replace(/\./g, "-")}`;
    return `/websites/${u.hostname.replace(/^www\./, "").replace(/\./g, "-")}`;
  } catch {
    return url;
  }
}
