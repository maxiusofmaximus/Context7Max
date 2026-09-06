import pc from "picocolors";
import { ingestSource, previewSource, type SourceKind } from "@ctx7max/ingestor";
import { addRemote } from "../apiClient.js";
import { loadConfig } from "../config.js";
import { wrapCmd } from "./library.js";

interface AddOptions {
  remote?: boolean;
  type?: string;
  version?: string;
  noEmbed?: boolean;
}

export const cmdAdd = wrapCmd(async (url: string, opts: AddOptions) => {
  if (opts.remote) {
    const res = (await addRemote(url, opts.type)) as { status: string; dispatched: boolean };
    console.log(pc.green(`✓ Ingesta encolada para ${url}`));
    console.log(
      pc.dim(
        res.dispatched
          ? "El worker de GitHub Actions ha sido notificado."
          : "Sin dispatch directo: el worker programado la recogerá (o ejecuta local: ctx7max add <url>).",
      ),
    );
    return;
  }

  const cfg = loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error(
      "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Configúralos: ctx7max config --supabase-url <url> --supabase-key <service_role>\n" +
        "o usa --remote para ingestar vía el worker de GitHub Actions.",
    );
  }

  const env = {
    supabaseUrl: cfg.supabaseUrl,
    serviceRoleKey: cfg.supabaseServiceRoleKey,
  };

  console.log(pc.bold(`\nIngestando ${url}\n`));
  const t0 = Date.now();
  const result = await ingestSource(url, {
    env,
    type: (opts.type as SourceKind) ?? "auto",
    version: opts.version,
    embed: !opts.noEmbed,
    githubToken: cfg.githubToken,
    actor: "cli",
    onLog: (m) => console.log(pc.dim(`  → ${m}`)),
  });

  console.log(pc.green(`\n✓ ${result.libraryId} indexada`));
  console.log(
    pc.dim(
      `  ${result.files} archivos · ${result.codeSnippets} code snippets · ` +
        `${result.infoSnippets} info · ${(result.totalTokens / 1000).toFixed(1)}k tokens · ` +
        `embeddings: ${result.embeddedPct}% · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    ),
  );
  console.log(pc.dim(`\n  Prueba: ctx7max docs ${result.libraryId} "cómo empezar"`));
});

interface PreviewOptions {
  type?: string;
  version?: string;
}

export const cmdPreview = wrapCmd(async (url: string, opts: PreviewOptions) => {
  const cfg = loadConfig();
  const preview = await previewSource(url, {
    type: (opts.type as SourceKind) ?? "auto",
    version: opts.version,
    githubToken: cfg.githubToken,
    env: { supabaseUrl: "n/a", serviceRoleKey: "n/a" },
  });
  console.log(pc.bold(`\n${preview.title} `) + pc.cyan(preview.libraryId));
  console.log(
    pc.dim(
      `${preview.fileCount} archivos se indexarían (${(preview.totalBytes / 1024).toFixed(0)} KB)` +
        (preview.versions.length ? ` · versiones: ${preview.versions.slice(0, 5).join(", ")}` : ""),
    ),
  );
  for (const f of preview.files.slice(0, 25)) {
    console.log(pc.dim(`  • ${f.path} (${(f.bytes / 1024).toFixed(1)} KB)`));
  }
  if (preview.fileCount > 25) {
    console.log(pc.dim(`  … y ${preview.fileCount - 25} más`));
  }
});
