/**
 * Pure load-time choices for the WebLLM engine. Kept free of the web-llm import so tests
 * can pin the contract without starting a GPU.
 *
 * Installed @mlc-ai/web-llm 0.2.85 ChatOptions is Partial<ChatConfig>. The fields that
 * change the KV cache are context_window_size and sliding_window_size. The runtime
 * throws WindowSizeConfigurationError when both are positive ("Only one of
 * context_window_size and sliding_window_size can be positive"). Gemma3's weight
 * config keeps sliding_window_size 512 while the prebuilt model record sets
 * context_window_size 4096, so a Gemma3 load must pass sliding_window_size: -1.
 *
 * prefill_chunk_size is not a ChatOptions field. LLMChatPipeline reads it from wasm
 * metadata (`metadata.prefill_chunk_size`). Every Gemma library in this package is
 * compiled as `*_cs1k-*` (1024). Passing prefill_chunk_size here would be ignored.
 */

export const LOW_MEMORY_CONTEXT_WINDOW = 1024;

export interface LoadChatOptions {
  context_window_size?: number;
  sliding_window_size?: number;
}

/** Fourth argument to CreateWebWorkerMLCEngine. Undefined means "library defaults". */
export function chatOptionsForLoad(modelId: string, lowMemory: boolean): LoadChatOptions | undefined {
  const gemma3 = modelId.startsWith("gemma3-");
  if (!lowMemory) return gemma3 ? { sliding_window_size: -1 } : undefined;
  return gemma3
    ? { context_window_size: LOW_MEMORY_CONTEXT_WINDOW, sliding_window_size: -1 }
    : { context_window_size: LOW_MEMORY_CONTEXT_WINDOW };
}

/**
 * A gemma3 1B q4f32 entry, only when that exact id is already in the prebuilt list.
 * Returns null rather than inventing an id. q4f16 and other sizes do not count.
 */
export function gemma3NoF16Model(
  records: readonly { model_id: string }[],
): { id: string; label: string } | null {
  const hit = records.find(
    (r) => r.model_id.startsWith("gemma3-1b-") && r.model_id.includes("q4f32") && !r.model_id.includes("f16"),
  );
  if (!hit) return null;
  return { id: hit.model_id, label: "Gemma 3 1B (q4f32) — no-f16" };
}

/** Shape of the JSON behind "Copy metrics JSON". */
export function metricsDocument<D, R>(device: D, runs: R, lowMemory: boolean): {
  device: D;
  low_memory: boolean;
  runs: R;
} {
  return { device, low_memory: lowMemory, runs };
}
