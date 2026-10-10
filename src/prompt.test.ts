import { describe, it, expect } from "vitest";
import { buildPrompt, createSerializer, GENERATION, isGpuLost, extractJson } from "./prompt";
import { ExtractionSchema } from "./schema";
import { looksLikeLines, parseLines } from "./lines";
import { applyInterpretation, startCheckIn, submitReturn } from "./receipt";

describe("FR-AI-001 prompt", () => {
  it("carries the note verbatim and ends by starting the answer", () => {
    const p = buildPrompt("46 minutes. About 3 miles.");
    expect(p).toContain("Note: 46 minutes. About 3 miles.\nactivity:");
    expect(p.endsWith("activity:")).toBe(true);
  });
  it("its worked example is itself a valid extraction in the line format", () => {
    const p = buildPrompt("x");
    const example = p.slice(p.indexOf("activity: run"), p.indexOf("\n\nNote: x"));
    expect(looksLikeLines(example)).toBe(true);
    expect(ExtractionSchema.safeParse(parseLines(example)).success).toBe(true);
  });
  it("stays short: prompt length costs time on a phone", () => {
    expect(buildPrompt("46 minutes. About 3 miles.").length).toBeLessThan(700);
  });
});

describe("FR-AI-002 generation limits", () => {
  it("stops on blank-line runs and caps tokens well below the old 400", () => {
    expect(GENERATION.max_tokens).toBeLessThanOrEqual(120);
    expect(GENERATION.stop).toContain("\n\n");
  });
});

describe("FR-AI-003 one generation at a time", () => {
  it("never overlaps tasks and keeps order, even when one fails", async () => {
    const run = createSerializer();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const task = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push("start " + name);
        setTimeout(() => {
          active--;
          log.push("end " + name);
          fail ? reject(new Error(name)) : resolve(name);
        }, ms);
      });
    const results = await Promise.allSettled([run(task("a", 20)), run(task("b", 5, true)), run(task("c", 1))]);
    expect(maxActive).toBe(1);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});

describe("FR-AI-004 GPU loss detection", () => {
  it("recognises the lost-device and unmapped-buffer errors seen on the phone", () => {
    expect(isGpuLost(new Error("AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': [Device] is lost."))).toBe(true);
    expect(isGpuLost(new Error("Buffer was unmapped before mapping was resolved."))).toBe(true);
    expect(isGpuLost("Device was lost. This can happen due to insufficient memory")).toBe(true);
  });
  it("does not treat ordinary failures as GPU loss", () => {
    expect(isGpuLost(new Error("Model not loaded."))).toBe(false);
    expect(isGpuLost(new Error("json: Unterminated string"))).toBe(false);
  });
});

describe("FR-AI-005 tolerant extraction", () => {
  const OBJ =
    '{"activity":"walk","duration_minutes":46,"distance_miles":3,"observations":["wind"],"exceptions":[],"claimed_complete":null}';
  const FENCE = "```";

  it("returns a clean object unchanged", () => {
    expect(extractJson(OBJ)).toBe(OBJ);
  });
  it("strips code fences and trailing chatter", () => {
    expect(extractJson(FENCE + "json\n" + OBJ + "\n" + FENCE + "\nHope that helps!")).toBe(OBJ);
  });
  it("is not fooled by braces and escaped quotes inside strings", () => {
    const tricky =
      '{"activity":"a } b \\" c","duration_minutes":null,"distance_miles":null,"observations":[],"exceptions":[],"claimed_complete":null}';
    expect(extractJson("x " + tricky + " y")).toBe(tricky);
  });
  it("leaves truncated output alone so the real parse error is reported", () => {
    expect(extractJson('{"activity":"run","observations":["a",')).toBe('{"activity":"run","observations":["a",');
    expect(extractJson("no json here")).toBe("no json here");
  });
  it("a fenced model answer becomes an OK interpretation, raw text kept, claim untouched", async () => {
    const r0 = await submitReturn(
      startCheckIn(new Date("2026-10-10T12:00:00Z")),
      "46 minutes. About 3 miles.",
      new Date("2026-10-10T12:46:00Z"),
    );
    const raw = FENCE + "json\n" + OBJ + "\n" + FENCE;
    const r1 = applyInterpretation(r0, raw, "gemma3-1b", new Date("2026-10-10T13:00:00Z"));
    expect(r1.ai.status).toBe("OK");
    expect(r1.ai.raw_output).toBe(raw);
    expect(r1.verification.state).toBe(r0.verification.state);
    expect(r1.claim_hash).toBe(r0.claim_hash);
  });
});
