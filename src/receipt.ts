import { ExtractionSchema, type Extraction } from "./schema";
import { extractJson } from "./prompt";
import { looksLikeLines, parseLines } from "./lines";

/**
 * Deterministic receipt core. This module owns state, timestamps, and hashes.
 * The model only ever supplies text that is parsed into `ai.extraction`;
 * nothing the model says can change `verification`.
 *
 * Vocabulary: CLAIMED != CORROBORATED != VERIFIED != SEALED != REWARDED.
 * This build can only reach SELF_ATTESTED or HUMAN_CONFIRMED.
 */

export const APP_ID = "field-receipt/0.1";

export type VerificationState = "SELF_ATTESTED" | "HUMAN_CONFIRMED";
export type AiStatus = "PENDING" | "OK" | "FAILED" | "SKIPPED";
export type SourceType = "LIVE" | "SYNTHETIC";

export interface EvidenceItem {
  type: "SELF_NOTE";
  captured_at: string;
  sha256: string;
  text: string;
}

export interface Receipt {
  schema: typeof APP_ID;
  receipt_id: string;
  source_type: SourceType;
  actor_claim: {
    actor_id: string;
    claimed_start: string; // event time: when the person says they left
    claimed_end: string; // event time: when the person checked back in
  };
  evidence: EvidenceItem[];
  claim_hash: string;
  ai: {
    status: AiStatus;
    model: string | null;
    interpreted_at: string | null; // processing time, separate from event time
    extraction: Extraction | null;
    raw_output: string | null;
    error: string | null;
  };
  verification: {
    state: VerificationState;
    confirmed_at: string | null;
    corroborators: string[];
    missing: string[];
  };
  provenance: {
    created_at: string; // processing time
    device: string;
    offline_created: boolean;
    app: typeof APP_ID;
  };
}

export interface CheckInDraft {
  draft_id: string;
  claimed_start: string;
}

export interface SubmitOptions {
  actorId?: string;
  device?: string;
  offline?: boolean;
  sourceType?: SourceType;
}

// ---------- hashing ----------

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeClaimHash(r: Pick<Receipt, "receipt_id" | "actor_claim" | "evidence">): Promise<string> {
  return sha256Hex(
    canonicalJson({
      receipt_id: r.receipt_id,
      actor_claim: r.actor_claim,
      evidence: r.evidence.map((e) => ({ type: e.type, captured_at: e.captured_at, sha256: e.sha256 })),
    }),
  );
}

/** True when the claim and evidence still match the hash taken at submit time. */
export async function verifyClaimIntegrity(r: Receipt): Promise<boolean> {
  for (const e of r.evidence) {
    if ((await sha256Hex(e.text)) !== e.sha256) return false;
  }
  return (await computeClaimHash(r)) === r.claim_hash;
}

// ---------- state ----------

/** Always includes independent_corroboration: nothing in this build can supply it. */
export function computeMissing(r: Pick<Receipt, "ai" | "verification">): string[] {
  const missing = ["independent_corroboration"];
  if (r.ai.status !== "OK") missing.push("ai_interpretation");
  if (r.verification.state === "SELF_ATTESTED") missing.push("human_confirmation");
  return missing;
}

export function startCheckIn(now: Date): CheckInDraft {
  return { draft_id: crypto.randomUUID(), claimed_start: now.toISOString() };
}

/**
 * Creates the receipt from the raw note. Runs BEFORE any inference, so the
 * claim exists even if the model never loads, crashes, or the tab is killed.
 */
export async function submitReturn(
  draft: CheckInDraft,
  note: string,
  now: Date,
  opts: SubmitOptions = {},
): Promise<Receipt> {
  const text = note.trim();
  if (!text) throw new Error("Empty note: nothing to receipt.");
  const iso = now.toISOString();
  const receipt_id = crypto.randomUUID();
  const evidence: EvidenceItem[] = [
    { type: "SELF_NOTE", captured_at: iso, sha256: await sha256Hex(text), text },
  ];
  const actor_claim = {
    actor_id: opts.actorId ?? "local-user",
    claimed_start: draft.claimed_start,
    claimed_end: iso,
  };
  const base = {
    schema: APP_ID,
    receipt_id,
    source_type: opts.sourceType ?? "LIVE",
    actor_claim,
    evidence,
    claim_hash: await computeClaimHash({ receipt_id, actor_claim, evidence }),
    ai: {
      status: "PENDING" as AiStatus,
      model: null,
      interpreted_at: null,
      extraction: null,
      raw_output: null,
      error: null,
    },
    verification: {
      state: "SELF_ATTESTED" as VerificationState,
      confirmed_at: null,
      corroborators: [] as string[],
      missing: [] as string[],
    },
    provenance: {
      created_at: iso,
      device: opts.device ?? "unknown",
      offline_created: opts.offline ?? false,
      app: APP_ID,
    },
  };
  const receipt: Receipt = base as Receipt;
  receipt.verification.missing = computeMissing(receipt);
  return receipt;
}

/** Marks that no model interpretation will happen (e.g. model not loaded). */
export function markSkipped(r: Receipt, reason: string): Receipt {
  const next = structuredClone(r);
  next.ai = { ...next.ai, status: "SKIPPED", error: reason };
  next.verification.missing = computeMissing(next);
  return next;
}

/**
 * Parses raw model output. On any failure the raw output is retained and the
 * claim is untouched: "VALID CLAIM + INSUFFICIENT VERIFICATION", never "NO RECORD".
 * Under no outcome does `verification.state` change.
 */
export function applyInterpretation(
  r: Receipt,
  rawOutput: string,
  model: string,
  now: Date,
): Receipt {
  const next = structuredClone(r);
  const stamp = now.toISOString();
  let error: string | null = null;
  let extraction: Extraction | null = null;

  try {
    const parsed: unknown = looksLikeLines(rawOutput) ? parseLines(rawOutput) : JSON.parse(extractJson(rawOutput));
    const result = ExtractionSchema.safeParse(parsed);
    if (result.success) extraction = result.data;
    else error = "schema: " + result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
  } catch (e) {
    error = "json: " + (e instanceof Error ? e.message : String(e));
  }

  next.ai = {
    status: extraction ? "OK" : "FAILED",
    model,
    interpreted_at: stamp,
    extraction,
    raw_output: rawOutput,
    error,
  };
  next.verification.missing = computeMissing(next);
  return next;
}

/** The only path to HUMAN_CONFIRMED. Idempotent. */
export function humanConfirm(r: Receipt, now: Date): Receipt {
  if (r.verification.state === "HUMAN_CONFIRMED") return r;
  const next = structuredClone(r);
  next.verification.state = "HUMAN_CONFIRMED";
  next.verification.confirmed_at = now.toISOString();
  next.verification.missing = computeMissing(next);
  return next;
}

export function describeState(r: Receipt): string {
  const v = r.verification.state === "HUMAN_CONFIRMED" ? "CLAIM CONFIRMED BY PERSON" : "CLAIMED";
  return `${v} · not independently corroborated`;
}
