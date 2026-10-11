import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type MLCEngineInterface } from "@mlc-ai/web-llm";
import { buildPrompt, createSerializer, GENERATION, isGpuLost } from "./prompt";
import { withActivityKey } from "./lines";
import { chatOptionsForLoad, gemma3NoF16Model } from "./engine-options";

export { buildPrompt };
const serialize = createSerializer();

const BASE_MODELS = [
  { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 1B (q4f16, ~0.7 GB) — primary" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B (q4f16, ~1.9 GB) — fallback" },
  { id: "gemma-2-2b-it-q4f32_1-MLC-1k", label: "Gemma 2 2B (q4f32, 1k ctx, ~1.9 GB) — no-f16 fallback" },
] as const;

const noF16 = gemma3NoF16Model(prebuiltAppConfig.model_list);
export const MODELS = noF16 ? [...BASE_MODELS, noF16] : BASE_MODELS;

export interface InferenceResult {
  raw: string;
  elapsed_ms: number;
  completion_tokens: number | null;
  tokens_per_s: number | null;
}

let engine: MLCEngineInterface | null = null;
let worker: Worker | null = null;
let loadedModel: string | null = null;
let lowMemoryLoaded = false;

export function loadedModelId(): string | null {
  return loadedModel;
}

/** True when the engine currently on the GPU was loaded with low-memory chat options. */
export function loadedLowMemory(): boolean {
  return lowMemoryLoaded;
}

/** Unload the current model, stop its worker and forget it, so the UI shows that a model must be loaded again. */
export async function disposeEngine(): Promise<void> {
  const e = engine;
  const w = worker;
  engine = null;
  worker = null;
  loadedModel = null;
  lowMemoryLoaded = false;
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
  lowMemory = false,
): Promise<{ seconds: number }> {
  const t0 = performance.now();
  // Free the previous model first: each load otherwise leaves another copy on the GPU, and a phone GPU can lose its device.
  await disposeEngine();
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  engine = await CreateWebWorkerMLCEngine(
    worker,
    modelId,
    { initProgressCallback: (p) => onProgress(p.text, p.progress) },
    chatOptionsForLoad(modelId, lowMemory),
  );
  loadedModel = modelId;
  lowMemoryLoaded = lowMemory;
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
  // The prompt ends with "activity:" to start the answer, so the reply continues from there; put the key back for parsing and storage unless the reply already has it.
  const raw = withActivityKey(reply.choices[0]?.message?.content ?? "");
  const completion_tokens = reply.usage?.completion_tokens ?? null;
  const extra = (reply.usage as { extra?: { decode_tokens_per_s?: number } } | undefined)?.extra;
  const tokens_per_s =
    extra?.decode_tokens_per_s ?? (completion_tokens ? completion_tokens / (elapsed_ms / 1000) : null);
  return { raw, elapsed_ms, completion_tokens, tokens_per_s };
}
