import { parse as parseYaml } from "yaml";
import type { DocFile, IngestSourceResult } from "@ctx7max/core";
import { hashContent } from "@ctx7max/core";
import { fetchText } from "../util.js";

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string; version?: string };
  paths?: Record<
    string,
    Record<
      string,
      {
        summary?: string;
        description?: string;
        operationId?: string;
        tags?: string[];
        parameters?: unknown[];
        requestBody?: unknown;
        responses?: Record<string, { description?: string }>;
      }
    >
  >;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Convert an OpenAPI 3.x spec into documentation pages:
 * one page per tag, one fenced "http" example per operation.
 */
export async function fetchOpenApiSource(url: string): Promise<IngestSourceResult> {
  const raw = await fetchText(url);
  let spec: OpenApiDoc;
  try {
    spec = JSON.parse(raw) as OpenApiDoc;
  } catch {
    spec = parseYaml(raw) as OpenApiDoc;
  }
  if (!spec.paths || typeof spec.paths !== "object") {
    throw new Error(`No paths found in OpenAPI spec at ${url}`);
  }

  const byTag = new Map<string, string[]>();
  let pageCount = 0;

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "default";
      const lines: string[] = [];
      lines.push(`## ${method.toUpperCase()} ${path}`, "");
      if (op.summary) lines.push(op.summary, "");
      if (op.description) lines.push(op.description, "");
      if (Array.isArray(op.parameters) && op.parameters.length > 0) {
        lines.push("Parameters:", "");
        for (const p of op.parameters as {
          name?: string; in?: string; required?: boolean; description?: string;
        }[]) {
          lines.push(
            `- \`${p.name ?? "?"}\` (${p.in ?? "query"}${p.required ? ", required" : ""})${p.description ? ` — ${p.description}` : ""}`,
          );
        }
        lines.push("");
      }
      const responseDescs = Object.entries(op.responses ?? {})
        .map(([code, r]) => `${code}: ${r.description ?? ""}`.trim())
        .filter(Boolean);
      lines.push("```http");
      lines.push(`${method.toUpperCase()} ${path} HTTP/1.1`);
      lines.push("Host: api.example.com");
      lines.push("```");
      if (responseDescs.length) {
        lines.push("", "Responses:", "");
        for (const r of responseDescs.slice(0, 6)) lines.push(`- ${r}`);
      }
      lines.push("");
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(lines.join("\n"));
    }
  }

  const files: DocFile[] = [];
  for (const [tag, ops] of byTag) {
    if (++pageCount > 60) break;
    files.push({
      path: `api/${tag.replace(/[^\w\-]+/g, "_")}.md`,
      content: `# ${spec.info?.title ?? "API"} — ${tag}\n\n${ops.join("\n---\n\n")}`,
      sourceUrl: url,
    });
  }
  if (files.length === 0) throw new Error("No operations found in OpenAPI spec");

  const slug = (spec.info?.title ?? new URL(url).hostname)
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    libraryId: `/openapi/${slug}`,
    title: spec.info?.title ?? slug,
    description: spec.info?.description ?? `OpenAPI spec ${spec.info?.version ?? ""}`.trim(),
    sourceType: "openapi",
    sourceUrl: url,
    branch: null,
    repoSha: hashContent(raw).slice(0, 12),
    license: null,
    stars: 0,
    versions: spec.info?.version ? [spec.info.version] : [],
    files,
    rules: [],
    settings: {},
  };
}
