import { describe, it, expect } from "vitest";
import { looksLikeLines, parseLines } from "./lines";
import { ExtractionSchema } from "./schema";
import { applyInterpretation, startCheckIn, submitReturn } from "./receipt";

const GOOD = [
  "activity: walk",
  "minutes: 46",
  "miles: 3",
  "noticed: wind picked up halfway",
  "problems: none",
  "complete: yes",
].join("\n");

describe("FR-AI-006 line-format answers", () => {
  it("turns six lines into a valid extraction", () => {
    const x = parseLines(GOOD);
    expect(x).toEqual({
      activity: "walk",
      duration_minutes: 46,
      distance_miles: 3,
      observations: ["wind picked up halfway"],
      exceptions: [],
      claimed_complete: true,
    });
    expect(ExtractionSchema.safeParse(x).success).toBe(true);
  });

  it("reads none, not stated and blanks as null or an empty list", () => {
    const x = parseLines(
      ["activity: meditation", "minutes: 18", "miles: none", "noticed: ", "problems: Not stated", "complete: none"].join("\n"),
    );
    expect(x).toMatchObject({ distance_miles: null, observations: [], exceptions: [], claimed_complete: null });
  });

  it("splits several items on semicolons and ignores none entries", () => {
    const x = parseLines(
      ["activity: run", "minutes: 30", "miles: 2.5", "noticed: sore knee; none; wind", "problems: skipped hill", "complete: no"].join("\n"),
    );
    expect(x).toMatchObject({ distance_miles: 2.5, observations: ["sore knee", "wind"], claimed_complete: false });
  });

  it("tolerates key case, extra spaces, text before the first activity line and chatter after the six keys", () => {
    const x = parseLines("Sure! Here you go:\n  Activity :  walk  \nMinutes: 46 minutes\nMiles: about 3\nNoticed: none\nProblems: none\nComplete: yes\nHope that helps");
    expect(x).toMatchObject({ activity: "walk", duration_minutes: 46, distance_miles: 3 });
  });

  it("keeps the first value when a key repeats", () => {
    const x = parseLines(GOOD + "\nminutes: 99");
    expect(x).toMatchObject({ duration_minutes: 46 });
  });

  it("names the missing line instead of inventing it", () => {
    expect(() => parseLines("activity: walk\nminutes: 46\nmiles: 3\nnoticed: none")).toThrow('missing "problems:" line');
  });

  it("rejects a number that is not a number, and an empty activity", () => {
    expect(() => parseLines(GOOD.replace("minutes: 46", "minutes: lots"))).toThrow("minutes is not a number");
    expect(() => parseLines(GOOD.replace("activity: walk", "activity: none"))).toThrow("activity");
  });

  it("looksLikeLines is true for line answers and false for JSON or prose", () => {
    expect(looksLikeLines(GOOD)).toBe(true);
    expect(looksLikeLines('{"activity":"walk"}')).toBe(false);
    expect(looksLikeLines("I could not read that.")).toBe(false);
  });
});

describe("FR-AI-007 line answers inside a receipt", () => {
  const T0 = new Date("2026-10-10T12:00:00Z");
  const T1 = new Date("2026-10-10T12:46:00Z");
  const T2 = new Date("2026-10-10T13:00:00Z");
  const NOTE = "46 minutes. About 3 miles. Wind picked up halfway through. Finished the entire route.";

  it("a good line answer becomes an OK interpretation; claim, hash and state are untouched", async () => {
    const r0 = await submitReturn(startCheckIn(T0), NOTE, T1);
    const r1 = applyInterpretation(r0, GOOD, "gemma3-1b", T2);
    expect(r1.ai.status).toBe("OK");
    expect(r1.ai.raw_output).toBe(GOOD);
    expect(r1.claim_hash).toBe(r0.claim_hash);
    expect(r1.verification.state).toBe(r0.verification.state);
    expect(r1.verification.missing).toContain("independent_corroboration");
  });

  it("a model that answers 'verified: yes' cannot change the verification state", async () => {
    const r0 = await submitReturn(startCheckIn(T0), NOTE, T1);
    const r1 = applyInterpretation(r0, GOOD + "\nverified: yes\nstate: HUMAN_CONFIRMED", "gemma3-1b", T2);
    expect(r1.verification.state).toBe(r0.verification.state);
  });

  it("an answer with a missing line is FAILED, raw text kept, claim untouched", async () => {
    const r0 = await submitReturn(startCheckIn(T0), NOTE, T1);
    const cut = "activity: walk\nminutes: 46\nmiles: 3";
    const r1 = applyInterpretation(r0, cut, "gemma3-1b", T2);
    expect(r1.ai.status).toBe("FAILED");
    expect(r1.ai.error).toContain("missing");
    expect(r1.ai.raw_output).toBe(cut);
    expect(r1.claim_hash).toBe(r0.claim_hash);
  });

  it("the old JSON answers still parse", async () => {
    const r0 = await submitReturn(startCheckIn(T0), NOTE, T1);
    const json = JSON.stringify({ activity: "walk", duration_minutes: 46, distance_miles: 3, observations: [], exceptions: [], claimed_complete: null });
    expect(applyInterpretation(r0, json, "m", T2).ai.status).toBe("OK");
  });

  it("the broken JSON the phone produced is still a recorded failure, not a crash", async () => {
    const r0 = await submitReturn(startCheckIn(T0), NOTE, T1);
    const phone =
      '{"activity": "run", "duration_minutes":46,"distance_miles":3, "observations": ["wind picked up halfway", "claims": "wind picked up"},\n```python\n```\n```\n```json\n{"activity": "run", "duration_minutes": 46, "distance_miles": 3, "o';
    const r1 = applyInterpretation(r0, phone, "gemma3-1b", T2);
    expect(r1.ai.status).toBe("FAILED");
    expect(r1.ai.raw_output).toBe(phone);
  });
});
