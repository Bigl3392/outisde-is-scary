import { describe, it, expect } from "vitest";
import { installDeviceLossReporter, type GpuLossInfo } from "./gpu-loss";

describe("device-loss reporter", () => {
  it("publishes reason and message when the device the engine got is lost, and returns the same device", async () => {
    let resolveLost!: (v: { reason: string; message: string }) => void;
    const device = { lost: new Promise<{ reason: string; message: string }>((r) => (resolveLost = r)) };
    const proto = { requestDevice: async () => device };
    const seen: GpuLossInfo[] = [];
    expect(installDeviceLossReporter(proto, (i) => seen.push(i))).toBe(true);
    expect(await proto.requestDevice()).toBe(device);
    resolveLost({ reason: "unknown", message: "GPU hung" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ reason: "unknown", message: "GPU hung" });
  });
  it("does nothing when WebGPU is missing", () => {
    expect(installDeviceLossReporter(undefined, () => undefined)).toBe(false);
    expect(installDeviceLossReporter({}, () => undefined)).toBe(false);
  });
  it("never breaks requestDevice if the device has no lost promise", async () => {
    const proto = { requestDevice: async () => ({}) };
    installDeviceLossReporter(proto, () => undefined);
    await expect(proto.requestDevice()).resolves.toEqual({});
  });
});
