import { CreateWebWorkerMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { EXTRACTION_JSON_SCHEMA } from "./schema";

export const MODELS = [
  { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 1B (q4f16, ~0.7 GB) — primary" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B (q4f16, ~1.9 GB) — fallback" },
  { id: "gemma-2-2b-it-q4f32_1-MLC-1k", label: "Gemma 2 2B (q4f32, 1k ctx, ~1.9 GB) — no-f16 fallback" },
] as const;

export interface InferenceResult {
  raw: string;
  elapsed_ms: number;
  completion_tokens: number | null;
  tokens_per_s: number | null;
}

let engine: MLCEngineInterface | null = null;
let loadedModel: string | null = null;

export function loadedModelId(): string | null {
  return loadedModel;
}

/** Instructions go in the user turn: Gemma templates do not reliably honor a system role. */
export function buildPrompt(note: string): string {
  return [
    "Extract facts from a field note into JSON. Record only what the person said.",
    "Do not judge whether it is true. Use null when a value is not stated.",
    "Fields: activity (short snake_case label), duration_minutes, distance_miles,",
    "observations (things noticed), exceptions (problems, skipped or unfinished items),",
    "claimed_complete (true/false only if the person said so, else null).",
    "",
    "Note:",
    note,
  ].join("\n");
}

export async function loadModel(
  modelId: string,
  onProgress: (text: string, fraction: number) => void,
): Promise<{ seconds: number }> {
  const t0 = performance.now();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  engine = await CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: (p) => onProgress(p.text, p.progress),
  });
  loadedModel = modelId;
  return { seconds: (performance.now() - t0) / 1000 };
}

export async function interpret(note: string): Promise<InferenceResult> {
  if (!engine || !loadedModel) throw new Error("Model not loaded.");
  const t0 = performance.now();
  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: buildPrompt(note) }],
    temperature: 0,
    max_tokens: 400,
    response_format: { type: "json_object", schema: JSON.stringify(EXTRACTION_JSON_SCHEMA) },
  });
  const elapsed_ms = performance.now() - t0;
  const raw = reply.choices[0]?.message?.content ?? "";
  const completion_tokens = reply.usage?.completion_tokens ?? null;
  const extra = (reply.usage as { extra?: { decode_tokens_per_s?: number } } | undefined)?.extra;
  const tokens_per_s =
    extra?.decode_tokens_per_s ?? (completion_tokens ? completion_tokens / (elapsed_ms / 1000) : null);
  return { raw, elapsed_ms, completion_tokens, tokens_per_s };
}
