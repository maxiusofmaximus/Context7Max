import { getDocsText, type DocsOptions } from "../apiClient.js";
import { wrapCmd } from "./library.js";

export const cmdDocs = wrapCmd(
  async (libraryId: string, query: string, opts: DocsOptions) => {
    const out = await getDocsText(libraryId, query, opts);
    process.stdout.write(out.endsWith("\n") ? out : out + "\n");
  },
);
