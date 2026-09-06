import { getEncoding } from "js-tiktoken";

let encoder: ReturnType<typeof getEncoding> | null = null;

/** Approximate token counting; exact enough for budget/truncation math. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    encoder ??= getEncoding("cl100k_base");
    // cap pathological inputs
    const input = text.length > 120_000 ? text.slice(0, 120_000) : text;
    return encoder.encode(input).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/** Truncate text so it fits within a token budget (roughly). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (countTokens(text) <= maxTokens) return text;
  // fast path: 1 token ≈ 4 chars for code/docs
  let out = text.slice(0, maxTokens * 4);
  while (out.length > 200 && countTokens(out) > maxTokens) {
    out = out.slice(0, Math.floor(out.length * 0.85));
  }
  return out;
}
