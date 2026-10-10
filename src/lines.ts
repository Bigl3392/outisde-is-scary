/**
 * Line-format answers for the small on-device model.
 *
 * Gemma 3 1B on a phone cannot reliably write nested JSON: on the field phone it closed arrays wrongly, looped on
 * whitespace and repeated code fences until the token cap. A flat "key: value" answer is short, has no brackets to get
 * wrong, and is turned into the same extraction object by deterministic code here. Everything the model says still goes
 * through the zod schema afterwards and can never change the verification state.
 *
 * Numbers are strict: one number, an accepted unit, nothing else. A value the code cannot read safely makes the whole
 * interpretation FAILED (the receipt keeps the claim and the raw text); it is never guessed.
 */

const NONE = new Set(["", "none", "null", "n/a", "na", "not stated", "unknown", "-"]);

const KEYS = {
  activity: "activity",
  minutes: "duration_minutes",
  miles: "distance_miles",
  noticed: "observations",
  problems: "exceptions",
  complete: "claimed_complete",
} as const;

type LineKey = keyof typeof KEYS;

/** Units accepted for each measure, with the exact factor to the stored unit. Anything else is rejected. */
const MINUTE_UNITS: Record<string, number> = {
  "": 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
};
const MILE_UNITS: Record<string, number> = { "": 1, mi: 1, mile: 1, miles: 1 };

/** Hedging words the person may have said ("about 3 miles"); they are dropped, the number is kept. */
const HEDGE = /(~|\b(about|approx|approximately|roughly|around|nearly|almost)\b)/gi;

/** True when the text looks like a line-format answer (has an "activity:" line). */
export function looksLikeLines(text: string): boolean {
  return /^\s*activity\s*:/im.test(text);
}

/**
 * The prompt ends with "activity:" so the model continues from there. Put the key back in front of the reply only when
 * the reply does not already carry it, so a model that repeats the key does not produce "activity:activity: walk".
 */
export function withActivityKey(reply: string): string {
  return looksLikeLines(reply) ? reply : "activity:" + reply;
}

function isNone(v: string): boolean {
  return NONE.has(v.trim().toLowerCase().replace(/[.]+$/, ""));
}

/** One non-negative number plus an accepted unit (optionally hedged). Throws for anything else. */
function toMeasure(key: string, v: string, units: Record<string, number>): number | null {
  if (isNone(v)) return null;
  const text = v
    .trim()
    .replace(HEDGE, " ")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "")
    .trim()
    .toLowerCase();
  const m = /^(-?\d+(?:\.\d+)?) ?([a-z]*)$/.exec(text);
  if (!m) throw new Error(`lines: ${key} must be one number with an accepted unit: "${v.trim().slice(0, 40)}"`);
  const n = Number(m[1]);
  if (n < 0) throw new Error(`lines: ${key} is negative: "${v.trim().slice(0, 40)}"`);
  const factor = units[m[2]];
  if (factor === undefined) throw new Error(`lines: ${key} has an unaccepted unit "${m[2]}": "${v.trim().slice(0, 40)}"`);
  return n * factor;
}

function toList(v: string): string[] {
  if (isNone(v)) return [];
  return v
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isNone(s))
    .slice(0, 10);
}

function toBool(v: string): boolean | null {
  const t = v.trim().toLowerCase().replace(/[.]+$/, "");
  if (t === "yes" || t === "true") return true;
  if (t === "no" || t === "false") return false;
  return null;
}

/**
 * Parse the six "key: value" lines into the extraction shape. Throws a short Error naming what is wrong, so the
 * receipt records a precise failure. Lines before the first "activity:" and any extra text after the six keys are ignored.
 */
export function parseLines(text: string): Record<string, unknown> {
  const found = new Map<LineKey, string>();
  let started = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const k = m[1].toLowerCase() as LineKey;
    if (!(k in KEYS)) continue;
    if (k === "activity") started = true;
    if (!started) continue;
    if (!found.has(k)) found.set(k, m[2].trim());
  }
  for (const k of Object.keys(KEYS) as LineKey[]) {
    if (!found.has(k)) throw new Error(`lines: missing "${k}:" line`);
  }
  const activity = (found.get("activity") ?? "").trim();
  if (isNone(activity)) throw new Error('lines: "activity:" is empty');
  if (/^[A-Za-z_]+\s*:/.test(activity)) throw new Error(`lines: activity value looks like a repeated key: "${activity.slice(0, 40)}"`);
  return {
    activity: activity.slice(0, 80),
    duration_minutes: toMeasure("minutes", found.get("minutes") ?? "", MINUTE_UNITS),
    distance_miles: toMeasure("miles", found.get("miles") ?? "", MILE_UNITS),
    observations: toList(found.get("noticed") ?? ""),
    exceptions: toList(found.get("problems") ?? ""),
    claimed_complete: toBool(found.get("complete") ?? ""),
  };
}
