import pc from "picocolors";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, getConfigPath } from "../config.js";
import { health } from "../apiClient.js";
import { wrapCmd } from "./library.js";

export const cmdDoctor = wrapCmd(async () => {
  const cfg = loadConfig();
  let failures = 0;
  const ok = (msg: string) => console.log(pc.green("  ✓ ") + msg);
  const warn = (msg: string) => console.log(pc.yellow("  ⚠ ") + msg);
  const bad = (msg: string) => {
    failures++;
    console.log(pc.red("  ✖ ") + msg);
  };

  console.log(pc.bold("\nctx7max doctor\n"));

  // node
  const major = parseInt(process.version.slice(1), 10);
  major >= 18 ? ok(`Node.js ${process.version}`) : bad(`Node ${process.version} — se requiere >= 18`);

  // config
  console.log(pc.dim(`  config: ${getConfigPath()}`));
  cfg.apiUrl ? ok(`API URL: ${cfg.apiUrl}`) : bad("CTX7MAX_API_URL no configurada");
  cfg.apiKey ? ok("API key configurada") : warn("API key no configurada");
  cfg.adminKey ? ok("Admin key configurada") : warn("Admin key no configurada (add/refresh remote)");
  cfg.supabaseUrl && cfg.supabaseServiceRoleKey
    ? ok("Supabase service key configurada (ingesta local)")
    : warn("Supabase no configurado — solo comandos remotos disponibles");
  cfg.githubToken ? ok("GitHub token configurado (más rate limit)") : warn("GITHUB_TOKEN no definido (opcional, recomendado)");

  // API health
  if (cfg.apiUrl) {
    try {
      const h = await health();
      ok(`API: ${h.status} · DB: ${h.database} · ${h.libraries} libs · ${h.snippets} snippets`);
    } catch (err) {
      bad(`API no responde en ${cfg.apiUrl}: ${(err as Error).message}`);
    }
  }

  // direct DB
  if (cfg.supabaseUrl && cfg.supabaseServiceRoleKey) {
    try {
      const db = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      });
      const { error } = await db.from("libraries").select("id", { head: true, count: "exact" });
      if (error) throw new Error(error.message);
      ok("Supabase accesible");

      // edge function
      const t0 = Date.now();
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
        },
        body: JSON.stringify({ input: "doctor ping" }),
      });
      if (res.ok) {
        const j = (await res.json()) as { embeddings: number[][] };
        ok(`Edge Function embed viva (${Date.now() - t0} ms, dim ${j.embeddings[0]?.length ?? "?"})`);
      } else {
        warn(`Edge Function devuelve ${res.status} — búsqueda caerá a FTS`);
      }
    } catch (err) {
      bad(`Supabase: ${(err as Error).message}`);
    }
  }

  console.log(
    failures === 0
      ? pc.green("\nTodo listo.\n")
      : pc.red(`\n${failures} problema(s) encontrado(s).\n`),
  );
  process.exitCode = failures === 0 ? 0 : 1;
});
