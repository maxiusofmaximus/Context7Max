/**
 * Local embeddings via @huggingface/transformers — same model as the Supabase
 * Edge Function (Supabase/gte-small, 384 dims), so both sources produce
 * vectors in the SAME space and pgvector cosine search works across them.
 *
 * Runs offline after first model download; zero quota. Used by the CLI for
 * bulk ingestion; the API keeps using the Edge Function for single queries.
 */

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let pipePromise: Promise<FeatureExtractor> | null = null;

/** Nombre variable para que los bundlers NO resuelvan/rewritan el import. */
const HF_PKG = "@huggingface/transformers";

async function getPipeline(): Promise<FeatureExtractor> {
  pipePromise ??= (async () => {
    const mod: unknown = await import(HF_PKG);
    const anyMod = mod as {
      pipeline?: (task: string, model: string) => Promise<unknown>;
      default?: { pipeline?: (task: string, model: string) => Promise<unknown> };
    };
    const pipeline = anyMod.pipeline ?? anyMod.default?.pipeline;
    if (!pipeline) {
      throw new Error("@huggingface/transformers no expone pipeline en este entorno");
    }
    return (await pipeline(
      "feature-extraction",
      "Supabase/gte-small",
    )) as FeatureExtractor;
  })();
  return pipePromise;
}

export async function embedTextsLocal(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const extractor = await getPipeline();
  const out: number[][] = [];
  const CHUNK = 32;
  for (let i = 0; i < texts.length; i += CHUNK) {
    const slice = texts.slice(i, i + CHUNK);
    const res = await extractor(slice, { pooling: "mean", normalize: true });
    const vecs = res.tolist();
    for (const v of vecs) out.push(v);
    onProgress?.(Math.min(i + CHUNK, texts.length), texts.length);
  }
  return out;
}

/** true si el paquete está disponible en este entorno (local/CI) */
export async function hasLocalEmbeddings(): Promise<boolean> {
  try {
    await import(HF_PKG);
    return true;
  } catch (err) {
    console.warn(`[ctx7max] hasLocalEmbeddings error: ${(err as Error).message?.slice(0, 200)}`);
    return false;
  }
}
