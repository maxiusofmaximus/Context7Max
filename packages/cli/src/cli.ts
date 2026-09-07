#!/usr/bin/env node
import { Command } from "commander";
import { cmdLibrary } from "./commands/library.js";
import { cmdDocs } from "./commands/docs.js";
import { cmdAdd, cmdPreview } from "./commands/add.js";
import {
  cmdConfig,
  cmdList,
  cmdRefresh,
  cmdRemove,
  cmdStatus,
} from "./commands/manage.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdSetup } from "./commands/setup.js";
import {
  cmdGuide,
  cmdGuides,
  cmdSkillSearch,
  cmdSkillInstall,
  cmdMcps,
  cmdIngest,
} from "./commands/kb.js";

const program = new Command();

program
  .name("ctx7max")
  .description("Context7Max CLI — tu Context7 ilimitado (self-hosted)")
  .version("0.1.0");

program
  .command("library")
  .description("Busca librerías por nombre (paso 1: resolver el ID)")
  .argument("<name>", "nombre de la librería, p.ej. 'react', 'next.js'")
  .argument("<query>", "qué quieres hacer — mejora el ranking")
  .option("--json", "salida JSON")
  .action(cmdLibrary);

program
  .command("docs")
  .description("Trae la documentación relevante (paso 2)")
  .argument("<libraryId>", "ID tipo /org/repo (admite /org/repo/v1.2.3 o @v1.2.3)")
  .argument("<query>", "pregunta concreta")
  .option("--json", "salida JSON (por defecto: texto)")
  .option("--fast", "solo FTS (sin embeddings) — más rápido")
  .option("--max-tokens <n>", "presupuesto de tokens de la respuesta", (v) => parseInt(v, 10))
  .action((id, query, opts) =>
    cmdDocs(id, query, { json: opts.json, fast: opts.fast, maxTokens: opts.maxTokens }),
  );

program
  .command("add")
  .description("Indexa una librería/docs: GitHub repo, llms.txt URL, website u OpenAPI")
  .argument("<url>")
  .option("--type <kind>", "github | llmstxt | website | openapi (auto por defecto)")
  .option("--version <ref>", "tag o branch concreta (GitHub)")
  .option("--remote", "encola en el worker (GitHub Action) en vez de ingestar local")
  .option("--no-embed", "saltar embeddings (solo FTS)")
  .action(cmdAdd);

program
  .command("preview")
  .description("Dry-run: muestra qué archivos indexaría sin tocar la base de datos")
  .argument("<url>")
  .option("--type <kind>", "github | llmstxt | website | openapi")
  .option("--version <ref>", "tag o branch")
  .action(cmdPreview);

program
  .command("list")
  .alias("ls")
  .description("Lista librerías indexadas")
  .option("--json", "salida JSON")
  .action(cmdList);

program
  .command("status")
  .description("Estado de indexación de una librería")
  .argument("<libraryId>")
  .action(cmdStatus);

program
  .command("refresh")
  .description("Re-indexa una librería (por defecto remoto; --local desde tu PC)")
  .argument("<libraryId>")
  .option("--local", "ingestar localmente en vez de encolar")
  .action(cmdRefresh);

program
  .command("remove")
  .alias("rm")
  .description("Elimina una librería y sus snippets")
  .argument("<libraryId>")
  .option("--yes", "confirmar eliminación")
  .action(cmdRemove);

program
  .command("config")
  .description("Ver o guardar configuración (~/.config/ctx7max/config.json)")
  .option("--api-url <url>", "URL de tu API desplegada")
  .option("--api-key <key>", "clave de lectura")
  .option("--admin-key <key>", "clave admin (add/refresh)")
  .option("--supabase-url <url>", "Supabase project URL (ingesta local)")
  .option("--supabase-key <key>", "Supabase service role key (ingesta local)")
  .option("--github-token <token>", "GitHub token (más rate limit) ")
  .action(cmdConfig);

program
  .command("doctor")
  .description("Diagnóstico: node, config, API, Supabase, edge function")
  .action(cmdDoctor);

program
  .command("setup")
  .description("Instala el skill ctx7max para tu agente de IA")
  .option("--opencode", "OpenCode (~/.config/opencode/skills) [defecto]")
  .option("--claude", "Claude Code (~/.claude/skills)")
  .option("--agents", "Universal (~/.agents/skills)")
  .option("--all", "todos los destinos")
  .action(cmdSetup);

program
  .command("guide")
  .description("Guías paso a paso curadas (roadmaps, currículos) por dominio")
  .argument("<query>", "tema, p.ej. 'autenticación con JWT' o 'game loop'")
  .option("--domain <dominio>", "p.ej. android, gamedev, osdev (ver: ctx7max guides)")
  .option("--limit <n>", "número máximo de resultados", (v) => parseInt(v, 10))
  .option("--json", "salida JSON")
  .action(cmdGuide);

program
  .command("guides")
  .description("Lista los dominios de conocimiento disponibles")
  .option("--json", "salida JSON")
  .action(cmdGuides);

program
  .command("skill")
  .description("Skills de agente: search / install")
  .argument("<accion>", "search | install")
  .argument("<valor>", "query (search) o id (install)")
  .option("--limit <n>", "resultados máximos", (v) => parseInt(v, 10))
  .option("--json", "salida JSON")
  .action((accion, valor, opts) =>
    accion === "install"
      ? cmdSkillInstall(valor)
      : cmdSkillSearch(valor, opts),
  );

program
  .command("mcps")
  .description("Busca servidores MCP en los registros indexados")
  .argument("<query>")
  .action(cmdMcps);

program
  .command("ingest")
  .description("(admin) Indexa capas de conocimiento: guides | skills | mcps")
  .argument("<tipo>", "guides | skills | mcps")
  .argument("[source]", "solo para guides: roadmap.sh | ossu | freecodecamp | odin | fullstackopen | missing-semester")
  .option("--no-embed", "sin embeddings (solo FTS)")
  .action((tipo, source, opts) => cmdIngest(tipo, { source, noEmbed: opts.noEmbed }));

program
  .command("mcp")
  .description("Lanza el servidor MCP local (stdio) para clientes MCP")
  .action(async () => {
    await import("@ctx7max/mcp").then((m) => m.runServer()).catch(() => {
      console.error("El servidor MCP no está disponible en este build.");
      process.exit(1);
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
