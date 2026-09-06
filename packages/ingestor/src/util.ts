/** Fetch with timeout, retries, and a sane UA (docs crawlers etiquette). */

export class FetchError extends Error {
  constructor(
    public status: number,
    public url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "FetchError";
  }
}

const UA =
  "Context7Max-Ingestor/0.1 (+https://github.com/context7max; docs-indexing-bot)";

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const res = await fetchRaw(url, opts);
  if (!res.ok) throw new FetchError(res.status, url);
  return res.text();
}

export async function fetchBytes(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<Uint8Array> {
  const res = await fetchRaw(url, opts);
  if (!res.ok) throw new FetchError(res.status, url);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchRaw(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> },
): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*", ...opts.headers },
        signal: controller.signal,
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new FetchError(res.status, url);
        await sleep(500 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt + Math.random() * 300);
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof FetchError) throw lastErr;
  throw new Error(`fetch failed for ${url}: ${String(lastErr)}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** tiny promise pool */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = items[idx++]!;
      const r = await fn(current);
      if (r !== null && r !== undefined) results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}
