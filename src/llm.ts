import { CreateWebWorkerMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { buildPrompt, createSerializer, GENERATION, isGpuLost } from "./prompt";

export { buildPrompt };
const serialize = createSerializer();

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
let worker: Worker | null = null;
let loadedModel: string | null = null;

export function loadedModelId(): string | null {
  return loadedModel;
}

/** Unload the current model, stop its worker and forget it, so the UI shows that a model must be loaded again. */
export async function disposeEngine(): Promise<void> {
  const e = engine;
  const w = worker;
  engine = null;
  worker = null;
  loadedModel = null;
  try {
    await e?.unload();
  } catch {
    /* the device may already be gone */
  }
  w?.terminate();
}

export async function loadModel(
  modelId: string,
  onProgress: (text: string, fraction: number) => void,
): Promise<{ seconds: number }> {
  const t0 = performance.now();
  // Free the previous model first: each load otherwise leaves another copy on the GPU, and a phone GPU can lose its device.
  await disposeEngine();
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  engine = await CreateWebWorkerMLCEngine(
    worker,
    modelId,
    { initProgressCallback: (p) => onProgress(p.text, p.progress) },
    // web-llm's gemma3 record sets context_window_size 4096 while the model config keeps
    // sliding_window_size 512; web-llm rejects both being positive. Keep the 4096 context.
    modelId.startsWith("gemma3-") ? { sliding_window_size: -1 } : undefined,
  );
  loadedModel = modelId;
  return { seconds: (performance.now() - t0) / 1000 };
}

export function interpret(note: string): Promise<InferenceResult> {
  return serialize(async () => {
    try {
      return await runInterpret(note);
    } catch (e) {
      if (isGpuLost(e)) {
        await disposeEngine();
        throw new Error(`GPU device lost; press Load model, then Interpret with Gemma. (${e instanceof Error ? e.message : String(e)})`);
      }
      throw e;
    }
  });
}

async function runInterpret(note: string): Promise<InferenceResult> {
  if (!engine || !loadedModel) throw new Error("Model not loaded.");
  const t0 = performance.now();
  const reply = await engine.chat.completions.create({
    messages: [{ role: "user", content: buildPrompt(note) }],
    temperature: 0,
    max_tokens: GENERATION.max_tokens,
    stop: [...GENERATION.stop],
    // No grammar-constrained decoding: with it the model looped on whitespace after a closed array and the grammar compile
    // costs seconds on a phone. Output is checked afterwards by extractJson and the zod schema, which keep the claim separate.
  });
  const elapsed_ms = performance.now() - t0;
  const raw = reply.choices[0]?.message?.content ?? "";
  const completion_tokens = reply.usage?.completion_tokens ?? null;
  const extra = (reply.usage as { extra?: { decode_tokens_per_s?: number } } | undefined)?.extra;
  const tokens_per_s =
    extra?.decode_tokens_per_s ?? (completion_tokens ? completion_tokens / (elapsed_ms / 1000) : null);
  return { raw, elapsed_ms, completion_tokens, tokens_per_s };
}
