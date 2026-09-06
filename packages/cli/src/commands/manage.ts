import pc from "picocolors";
import { createDb, deleteLibrary, getDbEnv, listLibraries as listLibs } from "@ctx7max/core";
import { listLibraries, getStatus, refreshRemote } from "../apiClient.js";
import { loadConfig } from "../config.js";
import { wrapCmd } from "./library.js";

export const cmdList = wrapCmd(async (opts: { json?: boolean }) => {
  const data = (await listLibraries()) as {
    libraries: {
      id: string;
      title: string;
      state: string;
      total_snippets: number;
      total_tokens: number;
      stars: number;
      versions: string[];
    }[];
    catalogSize: number;
  };
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(pc.bold(`\n${data.libraries.length} librerías indexadas`) + pc.dim(` · catálogo: ${data.catalogSize} fuentes\n`));
  for (const l of data.libraries) {
    const state =
      l.state === "finalized" ? pc.green(l.state) : l.state === "error" ? pc.red(l.state) : pc.yellow(l.state);
    console.log(
      `${pc.cyan(l.id.padEnd(38))} ${state.padEnd(20)} ${pc.dim(`${l.total_snippets} snips · ${Math.round(l.total_tokens / 1000)}k tok · ★${l.stars}`)}`,
    );
  }
});

export const cmdStatus = wrapCmd(async (libraryId: string) => {
  const s = (await getStatus(libraryId)) as {
    libraryId: string;
    state: string;
    stateMessage: string | null;
    totalSnippets: number;
    totalTokens: number;
    versions: string[];
    quality: Record<string, unknown>;
    lastUpdateAt: string;
    lastJob: { status: string; stage: string | null; message: string | null } | null;
  };
  console.log(pc.bold(`\n${s.libraryId}`));
  console.log(`  estado:     ${s.state}${s.stateMessage ? pc.dim(` (${s.stateMessage})`) : ""}`);
  console.log(`  snippets:   ${s.totalSnippets}`);
  console.log(`  tokens:     ${s.totalTokens.toLocaleString()}`);
  console.log(`  versiones:  ${s.versions.join(", ") || "—"}`);
  console.log(`  quality:    ${JSON.stringify(s.quality)}`);
  console.log(`  actualizada: ${s.lastUpdateAt}`);
  if (s.lastJob) {
    console.log(`  último job: ${s.lastJob.status} · ${s.lastJob.stage ?? ""} ${s.lastJob.message ?? ""}`);
  }
});

export const cmdRefresh = wrapCmd(async (libraryId: string, opts: { local?: boolean }) => {
  if (opts.local) {
    const cfg = loadConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
      throw new Error("Faltan credenciales Supabase. Usa `ctx7max config` o quita --local.");
    }
    const { ingestSource } = await import("@ctx7max/ingestor");
    const db = createDb({ supabaseUrl: cfg.supabaseUrl, serviceRoleKey: cfg.supabaseServiceRoleKey });
    const lib = await (await import("@ctx7max/core")).getLibrary(db, libraryId);
    if (!lib) throw new Error(`Librería ${libraryId} no existe`);
    console.log(`Refrescando ${libraryId} desde ${lib.source_url}…`);
    const res = await ingestSource(lib.source_url, {
      env: { supabaseUrl: cfg.supabaseUrl, serviceRoleKey: cfg.supabaseServiceRoleKey },
      type: lib.source_type,
      githubToken: cfg.githubToken,
      actor: "cli",
      onLog: (m) => console.log(pc.dim(`  → ${m}`)),
    });
    console.log(pc.green(`✓ Actualizada: ${res.codeSnippets} snippets`));
    return;
  }
  await refreshRemote(libraryId);
  console.log(pc.green(`✓ Refresh encolado para ${libraryId}`));
});

export const cmdRemove = wrapCmd(async (libraryId: string, opts: { yes?: boolean }) => {
  const cfg = loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error("remove requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ctx7max config)");
  }
  if (!opts.yes) {
    console.log(pc.yellow(`Esto eliminará ${libraryId} y todos sus snippets. Repite con --yes`));
    return;
  }
  const db = createDb(getDbEnv());
  await deleteLibrary(db, libraryId);
  console.log(pc.green(`✓ ${libraryId} eliminada`));
});

export const cmdConfig = wrapCmd(
  async (opts: {
    apiUrl?: string;
    apiKey?: string;
    adminKey?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    githubToken?: string;
    show?: boolean;
  }) => {
    const { saveConfig, getConfigPath, loadConfig } = await import("../config.js");
    const patch: Record<string, string> = {};
    if (opts.apiUrl) patch.apiUrl = opts.apiUrl;
    if (opts.apiKey) patch.apiKey = opts.apiKey;
    if (opts.adminKey) patch.adminKey = opts.adminKey;
    if (opts.supabaseUrl) patch.supabaseUrl = opts.supabaseUrl;
    if (opts.supabaseKey) patch.supabaseServiceRoleKey = opts.supabaseKey;
    if (opts.githubToken) patch.githubToken = opts.githubToken;

    if (Object.keys(patch).length > 0) {
      const path = saveConfig(patch);
      console.log(pc.green(`✓ Config guardada en ${path}`));
      return;
    }
    const cfg = loadConfig();
    const mask = (v?: string) => (v ? v.slice(0, 8) + "…" : pc.dim("(no definido)"));
    console.log(pc.bold("\nConfiguración ctx7max") + pc.dim(` (${getConfigPath()})`));
    console.log(`  apiUrl:       ${cfg.apiUrl ?? pc.dim("(no definido)")}`);
    console.log(`  apiKey:       ${mask(cfg.apiKey)}`);
    console.log(`  adminKey:     ${mask(cfg.adminKey)}`);
    console.log(`  supabaseUrl:  ${cfg.supabaseUrl ?? pc.dim("(no definido)")}`);
    console.log(`  supabaseKey:  ${mask(cfg.supabaseServiceRoleKey)}`);
    console.log(`  githubToken:  ${mask(cfg.githubToken)}`);
    console.log(pc.dim("\nLos variables de entorno tienen prioridad sobre el archivo."));
  },
);
