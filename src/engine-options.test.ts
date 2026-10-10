import { describe, it, expect } from "vitest";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import {
  LOW_MEMORY_CONTEXT_WINDOW,
  chatOptionsForLoad,
  gemma3NoF16Model,
  metricsDocument,
} from "./engine-options";

const GEMMA3 = "gemma3-1b-it-q4f16_1-MLC";
const GEMMA2 = "gemma-2-2b-it-q4f16_1-MLC";

describe("chat options for load", () => {
  it("leaves non-Gemma3 models untouched in normal mode", () => {
    expect(chatOptionsForLoad(GEMMA2, false)).toBeUndefined();
  });

  it("keeps the Gemma3 sliding-window workaround and the default context in normal mode", () => {
    expect(chatOptionsForLoad(GEMMA3, false)).toEqual({ sliding_window_size: -1 });
  });

  it("asks for a 1024-token context in low-memory mode", () => {
    expect(LOW_MEMORY_CONTEXT_WINDOW).toBe(1024);
    expect(chatOptionsForLoad(GEMMA2, true)).toEqual({
      context_window_size: 1024,
    });
  });

  it("keeps the Gemma3 conflict workaround when shrinking the context", () => {
    expect(chatOptionsForLoad(GEMMA3, true)).toEqual({
      context_window_size: 1024,
      sliding_window_size: -1,
    });
  });

  it("does not set a prefill chunk size, which this web-llm build does not honor", () => {
    const opts = chatOptionsForLoad(GEMMA3, true);
    expect(opts).not.toHaveProperty("prefill_chunk_size");
    expect(chatOptionsForLoad(GEMMA2, true)).not.toHaveProperty("prefill_chunk_size");
  });
});

describe("gemma3 1B q4f32 model entry", () => {
  it("does not invent an id when the installed prebuilt list has none", () => {
    expect(gemma3NoF16Model(prebuiltAppConfig.model_list)).toBeNull();
  });

  it("uses a prebuilt gemma3 1B q4f32 id verbatim and labels it no-f16", () => {
    const id = "gemma3-1b-it-q4f32_1-MLC";
    expect(
      gemma3NoF16Model([
        { model_id: "gemma3-1b-it-q4f16_1-MLC" },
        { model_id: id },
      ]),
    ).toEqual({ id, label: "Gemma 3 1B (q4f32) — no-f16" });
  });

  it("ignores q4f16 gemma3, other-size gemma3, and gemma2 q4f32", () => {
    expect(
      gemma3NoF16Model([
        { model_id: "gemma3-1b-it-q4f16_1-MLC" },
        { model_id: "gemma3-4b-it-q4f32_1-MLC" },
        { model_id: "gemma-2-2b-it-q4f32_1-MLC-1k" },
      ]),
    ).toBeNull();
  });
});

describe("metrics document", () => {
  it("records low-memory on or off beside the device and runs", () => {
    const device = { webgpu: true };
    const runs = [{ kind: "load", ok: true }];
    expect(metricsDocument(device, runs, true)).toEqual({
      device,
      low_memory: true,
      runs,
    });
    expect(metricsDocument(device, runs, false).low_memory).toBe(false);
  });
});
