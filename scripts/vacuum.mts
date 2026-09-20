/**
 * VACUUM FULL de tablas grandes vía conexión directa (no por PostgREST).
 * Requiere DB password: env CTX7MAX_DB_PASSWORD o --db-password.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const cfg = JSON.parse(
  readFileSync(join(process.env.APPDATA ?? "", "ctx7max", "config.json"), "utf8"),
) as Record<string, string>;

// Pooler de sesión (puerto 5432) — db push no permite VACUUM dentro de tx.
const poolerPath = join(process.cwd(), "supabase", ".temp", "pooler-url");
const connectionString = readFileSync(poolerPath, "utf8").trim();
const password = process.env.CTX7MAX_DB_PASSWORD ?? throwErr("Falta CTX7MAX_DB_PASSWORD");

// Se reconstruye porque la URL del pooler carece de la password almacenada
const parsed = new URL(connectionString);
parsed.password = password;

const client = new pg.Client({ connectionString: parsed.toString() });

function throwErr(msg: string): never {
  throw new Error(msg);
}

const TABLES = [
  "info_snippets",
  "code_snippets",
  "skills",
  "guides",
  "decision_specs",
  "decision_log",
  "mcp_servers",
  "libraries",
  "catalog",
  "jobs",
];

await client.connect();
for (const table of TABLES) {
  process.stdout.write(`  VACUUM FULL ${table}… `);
  const t0 = Date.now();
  try {
    await client.query(`VACUUM FULL ANALYZE public."${table}"`);
    console.log(`ok (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (err) {
    console.log(`skip: ${(err as Error).message.split("\n")[0]}`);
  }
}
await client.end();
console.log("Hecho. Ejecuta scripts/db-size.mts para ver el resultado real.");
