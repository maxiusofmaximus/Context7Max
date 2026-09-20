/**
 * Consulta a GLM-5.3 (NVIDIA NIM) en streaming: la primera respuesta puede
 * tardar minutos (cold start). Streaming evita cortes por timeout total.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const auth = JSON.parse(
  readFileSync(join(process.env.USERPROFILE ?? "", ".local/share/opencode/auth.json"), "utf8"),
) as Record<string, { key: string }>;
const KEY = auth.nvidia?.key;
if (!KEY) throw new Error("No nvidia key in auth.json");

const SYSTEM = `Eres un arquitecto de sistemas senior con experiencia profunda en IA aplicada, herramientas de desarrollo, y diseño de plataformas. Estás ayudando a decidir el diseño de Context7Max. Responde en español, directo, con argumentos.`;

const PROMPT = `CONTEXTO DEL PROYECTO:
Context7Max es un clon self-hosted de Context7 (documentación de librerías verbatim para agentes IA) + registro de guías y skills. Stack: Supabase (Postgres free, 500MB — ya al límite) + Vercel serverless API (gratis) + GitHub Actions público + CLI Node local. Embeddings: gte-small vía Supabase Edge o local con @huggingface/transformers (CPU, gratis). Búsqueda híbrida pgvector 0.7 + FTS 0.3.

NOVEDAD A SOPORTAR: los "System One Models" tipo Jev (TypeSafe AI, sep-2026): modelos que NO generan texto; reciben {estado, preguntas tipadas} y devuelven decisiones con probabilidad calibrada (choice/score/noul). API de Jev: POST /v1/systemone {state, model, questions{id:{type,instructions,criteria}}} → {answers[id]{choice|score|noul,probabilities,confidence}}. Jev es propietario, waitlist, solo hosteado; $0.042/M input.

Equivalentes open-source verificados esta semana: Laya (@receptron/laya npm, TS nativo, ONNX ModernBERT-large, 1.7GB RAM), SemIf/ex-OpenJev (Python, logits en una sola pasada), kotoba typed-decisions (DeBERTa fine-tuned, ECE 0.022, Apache), llama.cpp (temperature=-1, n_probs, softmax sobre opción tokens), transformers.js (que ya tenemos instalado para embeddings, puede hacer zero-shot NLI con mDeBERTa).

Backends disponibles hoy: transformers.js local ya instalado para embeddings; GPU nula; línea libre.

LAS 4 DECISIONES PENDIENTES:
1. ALCANCE INICIAL del soporte a System One Models en Context7Max: ¿Fase 1 pura (tabla decision_specs + búsqueda + CLI read-only, sin ejecución) y validamos? ¿O ya incluir ejecución (run) desde el día 1?
2. BACKEND de ejecución local preferido: (a) llama.cpp softmax de opciones (control total, hay que levantar llama-server), (b) Laya (TS nativo, ~2GB RAM), (c) TypeSafe oficial (waitlist, suples date no llega aún), (d) nuestro transformers.js con zero-shot NLI / logit scoring Qwen-0.5B. ¿Cuál cascade y por qué?
3. GUARDIAN INTERNO: ¿uso el modelo de decisiones local DENTRO de mi pipeline de ingesta (audit content = prompt injection, quality gate)? Coste: ingesta más lenta; beneficio: no entra basura al registro de agentes.
4. CONVENCIÓN DE SKILLS BICAPA: propongo skill = SKILL.md (prosa LLM) + decisions.json (contrato ejecutable System One), ambos indexados y enlazados en la BD. ¿Bien? ¿Riesgo o alternativa?

Contexto extra: free tier de Supabase al límite (640/500 MB); solo quiero añadir cosas baratas/ligeras.

Para cada una: recomendación concreta + razón clave (2-4 puntos) + riesgo oculto. Cierra con una recomendación ejecutiva de 3 líneas.`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 420_000); // 7 min con margen

const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
  method: "POST",
  signal: controller.signal,
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    model: "z-ai/glm-5.3",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: PROMPT },
    ],
    temperature: 0.3,
    max_tokens: 2600,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  }),
});

if (!res.ok || !res.body) {
  console.error("HTTP", res.status, (await res.text()).slice(0, 400));
  process.exit(1);
}

const reader = res.body.getReader();
const dec = new TextDecoder();
let out = "";
let first = true;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = dec.decode(value, { stream: true });
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") break;
    try {
      const j = JSON.parse(data) as { choices: { delta: { content?: string } }[] };
      const delta = j.choices[0]?.delta?.content ?? "";
      out += delta;
      process.stdout.write(delta);
    } catch {
      /* heartbeat/bad line */
    }
  }
}
clearTimeout(timer);
console.log("\n\n[--- fin de streaming ---]");
