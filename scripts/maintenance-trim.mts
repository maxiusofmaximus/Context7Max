/**
 * Mantenimiento de tamaño (versión correcta, paginada):
 *  1) dedupe skills por content_hash
 *  2) recorte de info_snippets por librería (cap)
 *  3) recorte de skills.body a 30KB (los monstruos)
 *  4) reporte
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "@ctx7max/core";

const cfg = JSON.parse(
  readFileSync(join(process.env.APPDATA ?? "", "ctx7max", "config.json"), "utf8"),
) as Record<string, string>;
const db = createDb({
  supabaseUrl: cfg.supabaseUrl,
  serviceRoleKey: cfg.supabaseServiceRoleKey,
});

const INFO_CAP_PER_LIBRARY = 900;
const SKILL_BODY_CAP = 30_000;

async function size(): Promise<number> {
  const { data } = await db.rpc("db_size_info");
  return (data as { total_mb: number }).total_mb;
}

async function fetchAll<T>(table: string, select: string, orderBy?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(select).range(from, from + 999);
    if (orderBy) q = q.order(orderBy as never, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data as T[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

console.log(`ANTES: ${await size()} MB`);

// ── 1) skills: dedupe por content_hash completo ──
const skills = await fetchAll<{ id: string; content_hash: string; source: string; installs: number }>(
  "skills",
  "id, content_hash, source, installs",
);
const rank = (s: string) => (s === "github" ? 0 : s === "curated" ? 1 : 2);
const best = new Map<string, { id: string; installs: number }>();
for (const r of skills) {
  const cur = best.get(r.content_hash);
  if (!cur || r.installs > cur.installs || (r.installs === cur.installs && rank(r.source) < 0)) {
    best.set(r.content_hash, { id: r.id, installs: r.installs });
  }
}
const keep = new Set([...best.values()].map((v) => v.id));
const dupes = skills.filter((r) => !keep.has(r.id)).map((r) => r.id);
console.log(`skills duplicados a eliminar: ${dupes.length}`);
for (let i = 0; i < dupes.length; i += 300) {
  const batch = dupes.slice(i, i + 300);
  await db.from("skills").delete().in("id", batch);
}

// ── 2) skills: recortar body gigante ──
// (UPDATE masivo por lotes vía rpc no existe; usamos selectid)
const skillBodies = await fetchAll<{ id: string; body: string }>("skills", "id, body");
const fat = skillBodies.filter((r) => (r.body?.length ?? 0) > SKILL_BODY_CAP);
console.log(`skills con body > 30KB: ${fat.length}`);
for (let i = 0; i < fat.length; i += 50) {
  const batch = fat.slice(i, i + 50);
  await Promise.all(
    batch.map((r) =>
      db.from("skills").update({ body: r.body.slice(0, SKILL_BODY_CAP) + "\n\n[…truncado]" }).eq("id", r.id),
    ),
  );
}

// ── 3) info_snippets: cap por librería ──
const infoIds = await fetchAll<{ id: number; library_id: string }>("info_snippets", "id, library_id", "id");
const byLib = new Map<string, number[]>();
for (const r of infoIds) {
  const arr = byLib.get(r.library_id) ?? [];
  arr.push(r.id);
  byLib.set(r.library_id, arr);
}
let trimmed = 0;
for (const [, ids] of byLib) {
  if (ids.length <= INFO_CAP_PER_LIBRARY) continue;
  const drop = ids.slice(INFO_CAP_PER_LIBRARY);
  for (let i = 0; i < drop.length; i += 500) {
    await db.from("info_snippets").delete().in("id", drop.slice(i, i + 500));
  }
  trimmed += drop.length;
}
console.log(`info_snippets recortadas: ${trimmed}`);

console.log(`DESPUÉS: ${await size()} MB`);
