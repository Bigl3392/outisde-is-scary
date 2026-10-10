import { describe, it, expect } from "vitest";
import { looksLikeLines, parseLines, withActivityKey } from "./lines";
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
    expect(() => parseLines(GOOD.replace("minutes: 46", "minutes: lots"))).toThrow("minutes must be one number");
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

describe("FR-AI-008 regression: activity key is not doubled", () => {
  it("withActivityKey adds the key only when the reply does not already have it", () => {
    expect(withActivityKey(" walk\nminutes: 46")).toBe("activity: walk\nminutes: 46");
    expect(withActivityKey("activity: walk\nminutes: 46")).toBe("activity: walk\nminutes: 46");
    expect(withActivityKey("  Activity : walk")).toBe("  Activity : walk");
  });

  it("a reply that repeats the key parses to the real activity, not 'activity: walk'", () => {
    const reply = GOOD; // the model started with "activity: walk" itself
    const stored = withActivityKey(reply);
    expect(stored).toBe(GOOD);
    expect(parseLines(stored)).toMatchObject({ activity: "walk" });
  });

  it("if a doubled key ever reaches the parser it is rejected, not accepted with a wrong activity", () => {
    const doubled = "activity:" + GOOD; // "activity:activity: walk"
    expect(doubled.startsWith("activity:activity: walk")).toBe(true);
    expect(() => parseLines(doubled)).toThrow("repeated key");
  });

  it("receipt effect: a doubled key makes the interpretation FAILED and leaves the claim alone", async () => {
    const r0 = await submitReturn(startCheckIn(new Date("2026-10-10T12:00:00Z")), "46 minutes. About 3 miles.", new Date("2026-10-10T12:46:00Z"));
    const r1 = applyInterpretation(r0, "activity:" + GOOD, "gemma3-1b", new Date("2026-10-10T13:00:00Z"));
    expect(r1.ai.status).toBe("FAILED");
    expect(r1.ai.extraction).toBeNull();
    expect(r1.claim_hash).toBe(r0.claim_hash);
    expect(r1.verification.state).toBe(r0.verification.state);
  });
});

describe("FR-AI-009 regression: units are validated, never guessed", () => {
  const withLines = (minutes: string, miles: string) =>
    ["activity: walk", `minutes: ${minutes}`, `miles: ${miles}`, "noticed: none", "problems: none", "complete: none"].join("\n");

  it("a plain number or an accepted unit is read as before", () => {
    for (const [m, expected] of [["46", 46], ["46 minutes", 46], ["46 min", 46], ["about 46", 46], ["~46 mins.", 46], ["0", 0], ["12.5 minutes", 12.5]] as const) {
      expect(parseLines(withLines(m, "3")).duration_minutes).toBe(expected);
    }
    for (const [mi, expected] of [["3", 3], ["3 miles", 3], ["about 3 mi", 3], ["2.5 miles.", 2.5]] as const) {
      expect(parseLines(withLines("46", mi)).distance_miles).toBe(expected);
    }
  });

  it("hours convert exactly to minutes (the conversion is lossless)", () => {
    expect(parseLines(withLines("1 hour", "3")).duration_minutes).toBe(60);
    expect(parseLines(withLines("1.5 hrs", "3")).duration_minutes).toBe(90);
    expect(parseLines(withLines("2h", "3")).duration_minutes).toBe(120);
  });

  it("'miles: 5 km' is rejected, not read as 5 miles", () => {
    expect(() => parseLines(withLines("46", "5 km"))).toThrow('unaccepted unit "km"');
    expect(() => parseLines(withLines("46", "800 meters"))).toThrow("unaccepted unit");
    expect(() => parseLines(withLines("46", "3 laps"))).toThrow("unaccepted unit");
  });

  it("'minutes: 1 hour 20 minutes', ranges and other multi-number values are rejected, not read as 1", () => {
    for (const bad of ["1 hour 20 minutes", "30 to 40 minutes", "30-40", "1/2 hour", "1,000", "45 seconds", "an hour", "lots"]) {
      expect(() => parseLines(withLines(bad, "3")), bad).toThrow("lines: minutes");
    }
    expect(() => parseLines(withLines("46", "3 to 4 miles"))).toThrow("lines: miles");
  });

  it("negative values are rejected", () => {
    expect(() => parseLines(withLines("-5", "3"))).toThrow("negative");
  });

  it("receipt effect: an unsafe unit makes the interpretation FAILED, raw text kept, claim and state untouched", async () => {
    const r0 = await submitReturn(startCheckIn(new Date("2026-10-10T12:00:00Z")), "1 hour. About 5 km.", new Date("2026-10-10T13:00:00Z"));
    for (const raw of [withLines("46", "5 km"), withLines("1 hour 20 minutes", "3")]) {
      const r1 = applyInterpretation(r0, raw, "gemma3-1b", new Date("2026-10-10T13:05:00Z"));
      expect(r1.ai.status).toBe("FAILED");
      expect(r1.ai.extraction).toBeNull();
      expect(r1.ai.raw_output).toBe(raw);
      expect(r1.claim_hash).toBe(r0.claim_hash);
      expect(r1.verification.state).toBe(r0.verification.state);
    }
  });

  it("receipt effect: 'minutes: 1 hour' is recorded as 60 minutes, still only an interpretation", async () => {
    const r0 = await submitReturn(startCheckIn(new Date("2026-10-10T12:00:00Z")), "1 hour. About 3 miles.", new Date("2026-10-10T13:00:00Z"));
    const r1 = applyInterpretation(r0, withLines("1 hour", "about 3 miles"), "gemma3-1b", new Date("2026-10-10T13:05:00Z"));
    expect(r1.ai.status).toBe("OK");
    expect(r1.ai.extraction).toMatchObject({ duration_minutes: 60, distance_miles: 3 });
    expect(r1.verification.state).toBe(r0.verification.state);
    expect(r1.verification.missing).toContain("independent_corroboration");
  });
});
