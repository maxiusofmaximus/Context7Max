import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  /** Base URL of the deployed API, e.g. https://ctx7max.vercel.app */
  apiUrl?: string;
  /** Reader key for the public API */
  apiKey?: string;
  /** Admin key (add/refresh/remove) */
  adminKey?: string;
  /** Direct DB access for local ingestion */
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  githubToken?: string;
}

function configPath(): string {
  const base =
    process.env.CTX7MAX_CONFIG_HOME ??
    (process.platform === "win32"
      ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "ctx7max", "config.json");
}

export function loadConfig(): CliConfig {
  const path = configPath();
  let fileCfg: CliConfig = {};
  if (existsSync(path)) {
    try {
      fileCfg = JSON.parse(readFileSync(path, "utf8")) as CliConfig;
    } catch {
      fileCfg = {};
    }
  }
  // env wins over file
  return {
    apiUrl: process.env.CTX7MAX_API_URL ?? fileCfg.apiUrl,
    apiKey: process.env.CTX7MAX_API_KEY ?? fileCfg.apiKey,
    adminKey: process.env.CTX7MAX_ADMIN_KEY ?? fileCfg.adminKey,
    supabaseUrl: process.env.SUPABASE_URL ?? fileCfg.supabaseUrl,
    supabaseServiceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileCfg.supabaseServiceRoleKey,
    githubToken: process.env.GITHUB_TOKEN ?? fileCfg.githubToken,
  };
}

export function saveConfig(patch: Partial<CliConfig>): string {
  const path = configPath();
  const current = loadConfig();
  const next = { ...current, ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  return path;
}

export function getConfigPath(): string {
  return configPath();
}
