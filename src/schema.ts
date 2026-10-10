import { z } from "zod";

/**
 * What Gemma is allowed to produce: an extraction of what the person SAID.
 * It carries no verification, trust, or completion judgment — `claimed_complete`
 * is the person's claim, not a finding.
 */
export const ExtractionSchema = z.object({
  activity: z.string().min(1).max(80),
  duration_minutes: z.number().nonnegative().nullable(),
  distance_miles: z.number().nonnegative().nullable(),
  observations: z.array(z.string().max(200)).max(10),
  exceptions: z.array(z.string().max(200)).max(10),
  claimed_complete: z.boolean().nullable(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * Hand-written JSON Schema handed to the model's constrained decoder. The bounds are at or below ExtractionSchema above (arrays 6 here, 10 there):
 * without maxItems the decoder allows an unbounded array, and a 1B model at temperature 0 can loop on "null"
 * until max_tokens, which truncates the JSON (seen on the phone, 2026-10-09).
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    activity: { type: "string", maxLength: 80 },
    duration_minutes: { type: ["number", "null"] },
    distance_miles: { type: ["number", "null"] },
    observations: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
    exceptions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
    claimed_complete: { type: ["boolean", "null"] },
  },
  required: [
    "activity",
    "duration_minutes",
    "distance_miles",
    "observations",
    "exceptions",
    "claimed_complete",
  ],
} as const;
