import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  startCheckIn,
  submitReturn,
  applyInterpretation,
  humanConfirm,
  markSkipped,
  verifyClaimIntegrity,
  canonicalJson,
} from "./receipt";

const T0 = new Date("2026-10-09T12:00:00.000Z");
const T1 = new Date("2026-10-09T12:46:00.000Z");
const T2 = new Date("2026-10-09T13:30:00.000Z");
const NOTE = "46 minutes. About 3 miles. Wind picked up halfway through. Finished the entire route.";
const GOOD = JSON.stringify({
  activity: "outdoor_walk",
  duration_minutes: 46,
  distance_miles: 3,
  observations: ["wind picked up halfway"],
  exceptions : [],
  claimed_complete: true,
});

async function fresh() {
  return submitReturn(startCheckIn(T0), NOTE, T1);
}

describe("FR-AT-001 raw note retained pre-inference", () => {
  it("creates the receipt with verbatim note and AI pending", async () => {
    const r = await fresh();
    expect(r.evidence[0].text).toBe(NOTE);
    expect(r.ai.status).toBe("PENDING");
    expect(r.ai.extraction).toBeNull();
  });
  it("rejects an empty note", async () => {
    await expect(submitReturn(startCheckIn(T0), "   ", T1)).rejects.toThrow();
  });
  it("skipped inference still keeps the claim", async () => {
    const r = markSkipped(await fresh(), "model not loaded");
    expect(r.ai.status).toBe("SKIPPED");
    expect(r.evidence[0].text).toBe(NOTE);
  });
});

describe("FR-AT-002 AI cannot raise verification", () => {
  it("good output leaves SELF_ATTESTED", async () => {
    const r = applyInterpretation(await fresh(), GOOD, "gemma3-1b", T2);
    expect(r.ai.status).toBe("OK");
    expect(r.verification.state).toBe("SELF_ATTESTED");
  });
  it("model that asserts VERIFIED is ignored", async () => {
    const lying = JSON.stringify({
      ...JSON.parse(GOOD),
      verification_state: "VERIFIED",
      verified: true,
    });
    const r = applyInterpretation(await fresh(), lying, "gemma3-1b", T2);
    expect(r.verification.state).toBe("SELF_ATTESTED");
    expect(JSON.stringify(r.ai.extraction)).not.toContain("VERIFIED");
  });
});

describe("FR-AT-003 failed output retains raw, claim intact", () => {
  it.each([
    ["not json", "Sure! Here is your walk: 46 minutes"],
    ["wrong shape", JSON.stringify({ activity: "walk" })],
    ["wrong types", JSON.stringify({ ...JSON.parse(GOOD), duration_minutes: "forty-six" })],
  ])("%s", async (_name, raw) => {
    const before = await fresh();
    const r = applyInterpretation(before, raw, "gemma3-1b", T2);
    expect(r.ai.status).toBe("FAILED");
    expect(r.ai.raw_output).toBe(raw);
    expect(r.ai.error).toBeTruthy();
    expect(r.evidence).toEqual(before.evidence);
    expect(r.claim_hash).toBe(before.claim_hash);
    expect(r.verification.state).toBe("SELF_ATTESTED");
  });
});

describe("FR-AT-004 event time vs processing time", () => {
  it("keeps claimed times fixed when interpretation happens later", async () => {
    const r0 = await fresh();
    const r1 = applyInterpretation(r0, GOOD, "gemma3-1b", T2);
    expect(r1.actor_claim.claimed_start).toBe(T0.toISOString());
    expect(r1.actor_claim.claimed_end).toBe(T1.toISOString());
    expect(r1.provenance.created_at).toBe(T1.toISOString());
    expect(r1.ai.interpreted_at).toBe(T2.toISOString());
    expect(r1.ai.interpreted_at).not.toBe(r1.actor_claim.claimed_end);
    expect(r1.actor_claim).toEqual(r0.actor_claim);
  });
});

describe("FR-AT-005 human confirm", () => {
  it("is the only path to HUMAN_CONFIRMED and is idempotent", async () => {
    const r0 = applyInterpretation(await fresh(), GOOD, "m", T2);
    const r1 = humanConfirm(r0, T2);
    expect(r1.verification.state).toBe("HUMAN_CONFIRMED");
    expect(r1.verification.confirmed_at).toBe(T2.toISOString());
    const r2 = humanConfirm(r1, new Date("2026-10-10T00:00:00Z"));
    expect(r2.verification.confirmed_at).toBe(T2.toISOString());
  });
});

describe("FR-AT-006 hash", () => {
  it("is stable across interpretation and confirmation", async () => {
    const r0 = await fresh();
    const r1 = humanConfirm(applyInterpretation(r0, GOOD, "m", T2), T2);
    expect(r1.claim_hash).toBe(r0.claim_hash);
    expect(await verifyClaimIntegrity(r1)).toBe(true);
  });
  it("detects tampering with the note", async () => {
    const r = await fresh();
    const tampered = structuredClone(r);
    tampered.evidence[0].text = NOTE + " Also ran a marathon.";
    expect(await verifyClaimIntegrity(tampered)).toBe(false);
  });
  it("detects tampering with claimed times", async () => {
    const r = await fresh();
    const tampered = structuredClone(r);
    tampered.actor_claim.claimed_start = "2026-10-01T00:00:00.000Z";
    expect(await verifyClaimIntegrity(tampered)).toBe(false);
  });
  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe("FR-AT-007 missing list", () => {
  it("always names independent_corroboration, even after confirm", async () => {
    const r0 = await fresh();
    expect(r0.verification.missing).toContain("independent_corroboration");
    const r1 = humanConfirm(applyInterpretation(r0, GOOD, "m", T2), T2);
    expect(r1.verification.missing).toEqual(["independent_corroboration"]);
  });
});

describe("D-01 fixtures are synthetic and valid", () => {
  for (const name of ["bake", "inspection"]) {
    it(name, async () => {
      const fx = JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8"));
      expect(fx.source_type).toBe("SYNTHETIC");
      expect(fx.org).toBe("Ember & Oak Hospitality Group");
      const r = await submitReturn(
        { draft_id: "fx", claimed_start: fx.claimed_start },
        fx.note,
        new Date(fx.now),
        { sourceType: fx.source_type, actorId: fx.actor },
       );
      const out = applyInterpretation(r, JSON.stringify(fx.expected_model_output), "fixture", new Date(fx.now));
      expect(out.source_type).toBe("SYNTHETIC");
      expect(out.ai.status).toBe("OK");
      expect(out.verification.state).toBe("SELF_ATTESTED");
    });
  }
  it("README carries the synthetic-data notice", () => {
    expect(readFileSync("README.md", "utf8")).toMatch(/SYNTHETIC/);
  });
});

describe("D-02 / D-03 grep gates", () => {
  const files = ["src/receipt.ts", "src/schema.ts", "src/llm.ts", "src/main.ts", "src/store.ts", "README.md"];
  it("no secrets", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['4"][^'"]+['"]|C:\\keys/i);
    }
  });
  it("no INOS / TimeLine machinery", () => {
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/time[ _-]?token|trust[ _-]?weight|timeline canon/i);
    }
  });
});
