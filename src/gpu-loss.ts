/**
 * Device-loss details. WebLLM creates its WebGPU device inside the worker and does not report why it was lost, so the
 * worker wraps GPUAdapter.requestDevice and publishes the device's `lost` info on a BroadcastChannel. The page
 * records it in the metrics. The channel is separate from the worker's own message port, so WebLLM's protocol is untouched.
 */

export const GPU_LOSS_CHANNEL = "field-receipt-gpu-loss";

export interface GpuLossInfo {
  reason: string | null;
  message: string | null;
  at: string;
}

type Publish = (info: GpuLossInfo) => void;

/** Wrap requestDevice on the given adapter prototype. Safe to call when WebGPU is missing. Returns true when installed. */
export function installDeviceLossReporter(adapterProto: unknown, publish: Publish): boolean {
  const proto = adapterProto as { requestDevice?: (...a: unknown[]) => Promise<unknown> } | null | undefined;
  const original = proto?.requestDevice;
  if (!proto || typeof original !== "function") return false;
  proto.requestDevice = async function (this: unknown, ...args: unknown[]) {
    const device = (await original.apply(this, args)) as { lost?: Promise<{ reason?: string; message?: string }> } | null;
    try {
      void device?.lost?.then((i) => publish({ reason: i?.reason ?? null, message: i?.message ?? null, at: new Date().toISOString() }));
    } catch {
      /* diagnostics must never break the engine */
    }
    return device;
  };
  return true;
}

/** Page side: call `onLoss` for every device-loss report from the worker. Returns a function that stops listening. */
export function listenForDeviceLoss(onLoss: Publish): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const ch = new BroadcastChannel(GPU_LOSS_CHANNEL);
  ch.onmessage = (e: MessageEvent) => onLoss(e.data as GpuLossInfo);
  return () => ch.close();
}
