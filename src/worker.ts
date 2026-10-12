import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import { GPU_LOSS_CHANNEL, installDeviceLossReporter } from "./gpu-loss";

// Report why the GPU device is lost (reason and message) to the page; WebLLM does not surface it.
try {
  const gpuAdapter = (globalThis as { GPUAdapter?: { prototype: unknown } }).GPUAdapter;
  if (gpuAdapter && typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel(GPU_LOSS_CHANNEL);
    installDeviceLossReporter(gpuAdapter.prototype, (info) => ch.postMessage(info));
  }
} catch {
  /* diagnostics only */
}

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
