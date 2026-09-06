// Supabase Edge Function: text embeddings via built-in gte-small.
// Free, no external AI API required (Supabase.ai local inference).
//
// POST /functions/v1/embed
//   Authorization: Bearer <service_role JWT>   (required — anon is rejected)
//   { "inputs": ["text", ...] }  →  { "embeddings": [[384 floats], ...] }

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run: (
        input: string,
        opts: { mean_pool: boolean; normalize: boolean },
      ) => Promise<Iterable<number>>;
    };
  };
};

const MAX_INPUTS = 96;
// gte-small context is 512 tokens ≈ ~2000 chars; clip beyond that.
const MAX_CHARS = 2000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getRole(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (getRole(req) !== "service_role") {
    return json({ error: "forbidden", message: "service_role required" }, 403);
  }

  let body: { inputs?: unknown; input?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const raw = body?.inputs ?? body?.input;
  const texts: string[] = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? [raw]
      : [];
  if (texts.length === 0) return json({ error: "no_input" }, 400);
  if (texts.length > MAX_INPUTS) {
    return json({ error: "too_many_inputs", message: `max ${MAX_INPUTS} per call` }, 413);
  }

  const session = new Supabase.ai.Session("gte-small");
  const embeddings: number[][] = [];
  for (const text of texts) {
    const clipped = text.slice(0, MAX_CHARS);
    const vec = await session.run(clipped, { mean_pool: true, normalize: true });
    embeddings.push(Array.from(vec));
  }
  return json({ embeddings });
});
