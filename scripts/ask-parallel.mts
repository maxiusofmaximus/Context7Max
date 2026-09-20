/**
 * Carrera de consultas: 3 modelos externos responden la misma pregunta.
 * Queremos la primera respuesta VALIDA (no mezclada con la mía propia).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const auth = JSON.parse(
  readFileSync(join(process.env.USERPROFILE ?? "", ".local/share/opencode/auth.json"), "utf8"),
) as Record<string, { key: string }>;
const KEY = auth.nvidia?.key;

const PROMPT = `Context7Max añade soporte a "System One Models" tipo Jev (TypeSafe): POST {state, questions{id:{type,instructions,criteria}}} → answers con probabilidades. Backends locales posibles: llama.cpp (+softmax), Laya (TS/ONNX), transformers.js NLI. Cuatro preguntas de diseño — responde en español, conciso:

1) ¿Empiezo solo con el registro de decision specs (tabla + búsqueda+CLI de lectura) sin ejecución, o ya con ejecución local desde el día 1?
2) ¿Qué backend de ejecución LOCAL primero: llama.cpp vs Laya vs transformers.js? Uno solo.
3) ¿Uso el modelo de decisión como guardián DENTRO de mi propia ingesta (audit prompt-injection + quality gate)? Sí/no y por qué.
4) ¿Skill bicapa SKILL.md + decisions.json indexadas y enlazadas en BD = convención bien? ¿Mejor alternativa?
5) ¿Algún riesgo que no vea? Menciona 1-2.

Máx 700 palabras.`;

const MODELS = ["deepseek-ai/deepseek-v4-flash-0731", "google/gemma-4-31b-it", "z-ai/glm-5.3"];

async function ask(model: string): Promise<string> {
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: PROMPT }],
      temperature: 0.4,
      max_tokens: 1400,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  return `### ${model}\n\n${j.choices[0]?.message.content ?? "(vacío)"}`;
}

const results = await Promise.allSettled(MODELS.map(ask));
for (const r of results) {
  if (r.status === "fulfilled") {
    console.log(r.value);
    console.log("\n---\n");
  }
}
