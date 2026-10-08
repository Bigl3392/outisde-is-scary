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

/** Hand-written JSON Schema handed to the model's constrained decoder. */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    activity: { type: "string" },
    duration_minutes: { type: ["number", "null"] },
    distance_miles: { type: ["number", "null"] },
    observations: { type: "array", items: { type: "string" } },
    exceptions: { type: "array", items: { type: "string" } },
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
