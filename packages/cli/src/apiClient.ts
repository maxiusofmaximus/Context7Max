import type { ApiContextResponse, ApiSearchResponse } from "@ctx7max/core";
import { loadConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function baseUrl(): string {
  const url = loadConfig().apiUrl;
  if (!url) {
    throw new Error(
      "CTX7MAX_API_URL not configured. Run: ctx7max config --api-url https://tu-app.vercel.app",
    );
  }
  return url.replace(/\/+$/, "");
}

function headers(admin = false): Record<string, string> {
  const cfg = loadConfig();
  const key = admin ? cfg.adminKey : cfg.apiKey;
  if (!key) {
    throw new Error(
      admin
        ? "Admin key not configured. Run: ctx7max config --admin-key <key>"
        : "API key not configured. Run: ctx7max config --api-key <key>",
    );
  }
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function parseErr(res: Response): Promise<never> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  throw new ApiError(
    res.status,
    data?.error ?? `http_${res.status}`,
    data?.message ?? res.statusText,
  );
}

export async function searchLibraries(
  libraryName: string,
  query: string,
): Promise<ApiSearchResponse> {
  const u = new URL(`${baseUrl()}/api/v2/libs/search`);
  u.searchParams.set("libraryName", libraryName);
  u.searchParams.set("query", query);
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) await parseErr(res);
  return (await res.json()) as ApiSearchResponse;
}

export interface DocsOptions {
  json?: boolean;
  fast?: boolean;
  maxTokens?: number;
}

export async function getDocsText(
  libraryId: string,
  query: string,
  opts: DocsOptions,
): Promise<string> {
  const u = new URL(`${baseUrl()}/api/v2/context`);
  u.searchParams.set("libraryId", libraryId);
  u.searchParams.set("query", query);
  u.searchParams.set("type", opts.json ? "json" : "txt");
  if (opts.fast) u.searchParams.set("fast", "true");
  if (opts.maxTokens) u.searchParams.set("maxTokens", String(opts.maxTokens));
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) await parseErr(res);
  if (opts.json) {
    return JSON.stringify(await res.json(), null, 2);
  }
  return res.text();
}

export async function getStatus(libraryId: string): Promise<unknown> {
  const u = new URL(`${baseUrl()}/api/v2/libs/status`);
  u.searchParams.set("libraryId", libraryId);
  const res = await fetch(u, { headers: headers() });
  if (!res.ok) await parseErr(res);
  return res.json();
}

export async function listLibraries(): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/api/v2/libs/list`, { headers: headers() });
  if (!res.ok) await parseErr(res);
  return res.json();
}

export async function addRemote(url: string, type?: string): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/api/v2/add`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ url, type }),
  });
  if (!res.ok) await parseErr(res);
  return res.json();
}

export async function refreshRemote(libraryId: string): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/api/v1/refresh`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ libraryId }),
  });
  if (!res.ok) await parseErr(res);
  return res.json();
}

export async function health(): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}/api/health`);
  return (await res.json()) as Record<string, unknown>;
}

export type { ApiContextResponse };
