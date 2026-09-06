import { createHash } from "node:crypto";

/** SHA-256 hex of content — used for dedup and incremental refresh. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
