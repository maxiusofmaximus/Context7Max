import pc from "picocolors";
import { createDb } from "@ctx7max/core";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} from "@ctx7max/core";
import { loadConfig } from "../config.js";
import { wrapCmd } from "./library.js";

function dbFromConfig() {
  const cfg = loadConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error(
      "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Configúralas: ctx7max config",
    );
  }
  return createDb({
    supabaseUrl: cfg.supabaseUrl,
    serviceRoleKey: cfg.supabaseServiceRoleKey,
  });
}

function fmt(date: string | null): string {
  if (!date) return "nunca";
  const d = new Date(date);
  const ago = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (ago < 0) {
    return `expira ${d.toISOString().slice(0, 10)} (en ${-ago}d)`;
  }
  return `${d.toISOString().slice(0, 10)} (hace ${ago}d)`;
}

export const cmdKeysList = wrapCmd(async () => {
  const keys = await listApiKeys(dbFromConfig());
  if (keys.length === 0) {
    console.log(pc.yellow("No hay claves secundarias. Crea una: ctx7max keys create --label <nombre>"));
    return;
  }
  console.log(pc.bold(`\n${keys.length} clave(s) secundarias:\n`));
  for (const k of keys) {
    const status = k.revoked_at
      ? pc.red("revocada")
      : k.expires_at && new Date(k.expires_at).getTime() < Date.now()
        ? pc.yellow("expirada")
        : pc.green("activa");
    console.log(`  #${k.id} ${pc.cyan(k.label ?? "(sin etiqueta)")}  ${status}`);
    console.log(`    creada: ${fmt(k.created_at)}  ·  expira: ${fmt(k.expires_at)}  ·  último uso: ${fmt(k.last_used_at)}`);
  }
});

export const cmdKeysCreate = wrapCmd(
  async (opts: { label: string; expiresIn?: string }) => {
    const days = parseExpires(opts.expiresIn);
    const out = await createApiKey(dbFromConfig(), {
      label: opts.label,
      expiresInDays: days,
    });
    console.log(pc.green(`\n✓ Clave creada (#${out.id}, label: "${opts.label}")\n`));
    console.log(pc.bold(`  ${out.key}`));
    console.log(
      pc.yellow("\nGuárdala ya: no se puede volver a mostrar (está hasheada en la BD)."),
    );
    if (out.expiresAt) console.log(pc.dim(`  expira: ${out.expiresAt}`));
    console.log(pc.dim("Uso: Authorization: Bearer <key> en /api/v2/*"));
  },
);

export const cmdKeysRevoke = wrapCmd(async (idStr: string | undefined) => {
  const id = parseId(idStr);
  await revokeApiKey(dbFromConfig(), id);
  console.log(pc.green(`✓ clave #${id} revocada (inmediata)`));
});

export const cmdKeysRotate = wrapCmd(
  async (idStr: string | undefined) => {
    const id = parseId(idStr);
    const out = await rotateApiKey(dbFromConfig(), id);
    console.log(pc.green(`\n✓ Rotada (#${id} revocada, nueva #${out.id})\n`));
    console.log(pc.bold(`  ${out.key}`));
    console.log(pc.yellow("\nGuárdala ya: no se puede volver a mostrar."));
  },
  );

function parseId(s: string | undefined): number {
  const n = parseInt(String(s ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error("ID inválido (usa ctx7max keys list)");
  return n;
}

/** Convierte "30d" | "12h" | "never" | undefined → días (null = nunca). */
function parseExpires(input?: string): number | null {
  if (!input || input === "never") return null;
  const m = input.match(/^(\d+)\s*(d|días?|days?|h|horas?|hours?)$/i);
  if (!m) throw new Error(`Formato inválido "${input}". Ejemplos: 30d, 12h, never`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith("h")) return n / 24;
  return n;
}
