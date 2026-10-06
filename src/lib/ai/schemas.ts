import { z } from "zod/v4";

// The shape of each role's output, declared once. The same object is
//   (1) converted to JSON Schema and sent to the provider with the request, and
//   (2) used to validate the reply in our own code when it arrives.
// The provider's schema enforcement is a help, not a guarantee, so (2) is the
// check that decides whether a job is DONE.

const item = z.string().trim().min(1).max(300);
const list = z.array(item).max(25);

export const extractionSchema = z.strictObject({
  isJobDescription: z.boolean(),
  title: z.string().trim().min(1).max(200).nullable(),
  company: z.string().trim().min(1).max(200).nullable(),
  location: z.string().trim().min(1).max(200).nullable(),
  workMode: z.enum(["remote", "hybrid", "onsite", "unspecified"]),
  employmentType: z.enum(["full_time", "part_time", "contract", "internship", "unspecified"]),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "unspecified"]),
  minYearsExperience: z.number().int().min(0).max(50).nullable(),
  mustHave: list,
  niceToHave: list,
  responsibilities: list,
});

export const summarySchema = z.strictObject({
  headline: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1500),
  questionsToAsk: z.array(z.string().trim().min(1).max(250)).max(3),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type Summary = z.infer<typeof summarySchema>;

/** JSON Schema for the provider's structured-output option. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; problem: string };

/** Turns the model's raw text into validated data, or says exactly why it could not. */
export function parseModelOutput<T>(schema: z.ZodType<T>, rawText: string): ValidationResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, problem: "The reply was not valid JSON." };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, problem: `The reply did not match the expected shape. ${issues.join("; ")}` };
}
