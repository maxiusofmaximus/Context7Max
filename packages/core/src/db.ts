import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogRow,
  CodeSnippetRow,
  InfoSnippetRow,
  JobRow,
  LibraryRow,
} from "./types.js";

export interface DbEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function getDbEnv(env: NodeJS.ProcessEnv = process.env): DbEnv {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example",
    );
  }
  return { supabaseUrl, serviceRoleKey };
}

export function createDb(env: DbEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Embeddings (Supabase Edge Function, gte-small) ─────────────────

// Small batches: gte-small runs CPU inference inside the Edge isolate —
// big payloads hit WORKER_RESOURCE_LIMIT.
const EMBED_BATCH = 8;

export async function embedTexts(
  env: DbEnv,
  texts: string[],
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  let consecutiveFailures = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const res = await fetch(`${env.supabaseUrl}/functions/v1/embed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.serviceRoleKey}`,
          },
          body: JSON.stringify({ inputs: batch }),
        });
        if (!res.ok)
          throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { embeddings: number[][] };
        if (!Array.isArray(data.embeddings)) throw new Error("bad embed payload");
        data.embeddings.forEach((e, j) => {
          out[i + j] = e;
        });
        done = true;
        consecutiveFailures = 0;
      } catch (err) {
        console.warn(
          `[ctx7max] embeddings batch ${i} failed (attempt ${attempt + 1}): ${(err as Error).message}`,
        );
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (!done) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.warn("[ctx7max] 3 lotes de embeddings fallidos seguidos — continuo sin vectores (modo FTS)");
        break;
      }
    }
    // breathing room for the shared isolate
    await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}

export async function embedQuery(
  env: DbEnv,
  text: string,
): Promise<number[] | null> {
  const [v] = await embedTexts(env, [text]);
  return v ?? null;
}

// ── Catalog ──────────────────────────────────────────────────────────

export async function upsertCatalog(
  db: SupabaseClient,
  rows: CatalogRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db
      .from("catalog")
      .upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`catalog upsert: ${error.message}`);
  }
}

// ── Libraries ────────────────────────────────────────────────────────

export async function upsertLibrary(
  db: SupabaseClient,
  row: LibraryRow,
): Promise<void> {
  const { error } = await db.from("libraries").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`library upsert: ${error.message}`);
}

export async function getLibrary(
  db: SupabaseClient,
  id: string,
): Promise<LibraryRow | null> {
  const { data, error } = await db
    .from("libraries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`get library: ${error.message}`);
  return (data as LibraryRow) ?? null;
}

export async function listLibraries(
  db: SupabaseClient,
): Promise<LibraryRow[]> {
  const { data, error } = await db
    .from("libraries")
    .select("*")
    .order("title", { ascending: true });
  if (error) throw new Error(`list libraries: ${error.message}`);
  return (data as LibraryRow[]) ?? [];
}

export async function deleteLibrary(
  db: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await db.from("libraries").delete().eq("id", id);
  if (error) throw new Error(`delete library: ${error.message}`);
}

export async function setLibraryState(
  db: SupabaseClient,
  id: string,
  state: LibraryRow["state"],
  message?: string,
): Promise<void> {
  const { error } = await db
    .from("libraries")
    .update({ state, state_message: message ?? null, last_update_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`set state: ${error.message}`);
}

export async function updateLibraryStats(
  db: SupabaseClient,
  id: string,
  stats: {
    total_tokens: number;
    total_snippets: number;
    versions?: string[];
    repo_sha?: string | null;
    quality?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db
    .from("libraries")
    .update({ ...stats, last_update_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`update stats: ${error.message}`);
}

// ── Snippets ─────────────────────────────────────────────────────────

export async function deleteSnippets(
  db: SupabaseClient,
  libraryId: string,
  version?: string,
): Promise<void> {
  for (const table of ["code_snippets", "info_snippets"] as const) {
    let q = db.from(table).delete().eq("library_id", libraryId);
    if (version) q = q.eq("version", version);
    const { error } = await q;
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
}

const INSERT_CHUNK = 400;

export async function insertCodeSnippets(
  db: SupabaseClient,
  rows: Omit<CodeSnippetRow, "id">[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await db
      .from("code_snippets")
      .upsert(rows.slice(i, i + INSERT_CHUNK), {
        onConflict: "library_id,version,content_hash",
      });
    if (error) throw new Error(`insert code snippets: ${error.message}`);
  }
}

export async function insertInfoSnippets(
  db: SupabaseClient,
  rows: Omit<InfoSnippetRow, "id">[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await db
      .from("info_snippets")
      .upsert(rows.slice(i, i + INSERT_CHUNK), {
        onConflict: "library_id,version,content_hash",
      });
    if (error) throw new Error(`insert info snippets: ${error.message}`);
  }
}

// ── Jobs ─────────────────────────────────────────────────────────────

export async function createJob(
  db: SupabaseClient,
  job: Omit<JobRow, "id" | "created_at" | "updated_at">,
): Promise<string> {
  const { data, error } = await db
    .from("jobs")
    .insert(job)
    .select("id")
    .single();
  if (error) throw new Error(`create job: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updateJob(
  db: SupabaseClient,
  id: string,
  patch: Partial<JobRow>,
): Promise<void> {
  const { error } = await db
    .from("jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`update job: ${error.message}`);
}

export async function getLatestJob(
  db: SupabaseClient,
  libraryId: string,
): Promise<JobRow | null> {
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .eq("library_id", libraryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`get job: ${error.message}`);
  return (data as JobRow) ?? null;
}

// ── Search RPCs ──────────────────────────────────────────────────────

export interface SearchLibrariesRow {
  id: string;
  title: string;
  description: string | null;
  source_type: string;
  stars: number;
  trust_score: number;
  indexed: boolean;
  state: string | null;
  total_tokens: number | null;
  total_snippets: number | null;
  versions: string[] | null;
  last_update_at: string | null;
  branch: string | null;
  score: number;
}

export async function searchLibraries(
  db: SupabaseClient,
  name: string,
  query: string,
  limit = 8,
): Promise<SearchLibrariesRow[]> {
  const { data, error } = await db.rpc("search_libraries", {
    p_name: name,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(`search_libraries: ${error.message}`);
  return (data as SearchLibrariesRow[]) ?? [];
}

export interface MatchContextResult {
  codeSnippets: {
    title: string;
    description: string | null;
    language: string | null;
    tokens: number;
    source_url: string | null;
    source_file: string | null;
    breadcrumb: string | null;
    code: string;
    score: number;
  }[];
  infoSnippets: {
    page_title: string | null;
    breadcrumb: string | null;
    content: string;
    tokens: number;
    source_url: string | null;
    score: number;
  }[];
}

export async function matchContext(
  db: SupabaseClient,
  params: {
    libraryId: string;
    version: string | null;
    query: string;
    embedding: number[] | null;
    maxTokens: number;
    fast?: boolean;
  },
): Promise<MatchContextResult> {
  const { data, error } = await db.rpc("match_context", {
    p_library_id: params.libraryId,
    p_version: params.version,
    p_query: params.query,
    p_embedding: params.embedding,
    p_max_tokens: params.maxTokens,
    p_fast: params.fast ?? false,
  });
  if (error) throw new Error(`match_context: ${error.message}`);
  return data as MatchContextResult;
}

// ── Health ───────────────────────────────────────────────────────────

export async function healthCheck(db: SupabaseClient): Promise<{
  ok: boolean;
  libraries: number;
  snippets: number;
}> {
  const libs = await db
    .from("libraries")
    .select("id", { count: "exact", head: true });
  const snips = await db
    .from("code_snippets")
    .select("id", { count: "exact", head: true });
  return {
    ok: !libs.error && !snips.error,
    libraries: libs.count ?? 0,
    snippets: snips.count ?? 0,
  };
}
