/**
 * Pure helpers for the Gemma call (kept free of the web-llm import so they can be unit tested).
 * Instructions go in the user turn: Gemma templates do not reliably honor a system role.
 */

// One short worked example: prompt length costs time on a phone (prefill runs at roughly 20 tokens per second there).
const EXAMPLE = {
  note: "Ran 30 minutes, about 2 miles. Skipped the last hill.",
  json: {
    activity: "run",
    duration_minutes: 30,
    distance_miles: 2,
    observations: [],
    exceptions: ["Skipped the last hill"],
    claimed_complete: null,
  },
};

export function buildPrompt(note: string): string {
  return [
    "Turn a field note into one line of JSON with these keys: activity, duration_minutes, distance_miles, observations, exceptions, claimed_complete.",
    "Record only what the person said. Use null for a number not stated, [] for nothing to list, and null for claimed_complete unless the person said so.",
    "Write only the JSON.",
    "",
    `Note: ${EXAMPLE.note}`,
    `JSON: ${JSON.stringify(EXAMPLE.json)}`,
    "",
    `Note: ${note}`,
    "JSON:",
  ].join("\n");
}

/** Runs async tasks one at a time, in order: the GPU engine must never see two generations at once. */
export function createSerializer() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Generation limits for the extraction call. Valid output is one line of about 40 to 100 tokens. */
export const GENERATION = {
  max_tokens: 160,
  /** Valid output has no blank lines; a run of whitespace is the degenerate loop seen on the phone. */
  stop: ["\n\n", "\n \n", "\n  \n"],
} as const;

/** True for the WebGPU failures that mean the GPU device is gone and the engine must be rebuilt. */
export function isGpuLost(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /device (is|was) lost|mapAsync|unmapped before mapping/i.test(m);
}

/**
 * The first balanced {...} object in the model's text, ignoring code fences and chatter around it.
 * Returns the text unchanged when there is no complete object, so the caller reports the real parse failure.
 */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return text;
}
