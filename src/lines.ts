/**
 * Line-format answers for the small on-device model.
 *
 * Gemma 3 1B on a phone cannot reliably write nested JSON: on the field phone it closed arrays wrongly, looped on
 * whitespace and repeated code fences until the token cap. A flat "key: value" answer is short, has no brackets to get
 * wrong, and is turned into the same extraction object by deterministic code here. Everything the model says still goes
 * through the zod schema afterwards and can never change the verification state.
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

/** True when the text looks like a line-format answer (has an "activity:" line). */
export function looksLikeLines(text: string): boolean {
  return /^\s*activity\s*:/im.test(text);
}

function isNone(v: string): boolean {
  return NONE.has(v.trim().toLowerCase().replace(/[.]+$/, ""));
}

function toNumber(key: string, v: string): number | null {
  if (isNone(v)) return null;
  const m = /-?\d+(\.\d+)?/.exec(v);
  if (!m) throw new Error(`lines: ${key} is not a number: "${v.trim().slice(0, 40)}"`);
  return Number(m[0]);
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
  return {
    activity: activity.slice(0, 80),
    duration_minutes: toNumber("minutes", found.get("minutes") ?? ""),
    distance_miles: toNumber("miles", found.get("miles") ?? ""),
    observations: toList(found.get("noticed") ?? ""),
    exceptions: toList(found.get("problems") ?? ""),
    claimed_complete: toBool(found.get("complete") ?? ""),
  };
}
