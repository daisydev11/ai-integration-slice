import type { Part } from "@google/genai";
import type { z } from "zod/v4";
import type { Document, Job } from "@prisma/client";
import { aiConfig, type RoleName } from "@/lib/ai/config";
import { callModel, ModelCallError } from "@/lib/ai/client";
import { extractionSchema, parseModelOutput, summarySchema, toProviderSchema } from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { JobError } from "@/lib/jobs/errors";
import { storage } from "@/lib/storage";

const ROLE_FOR = { EXTRACT: "extractor", SUMMARISE: "summariser" } as const satisfies Record<Job["kind"], RoleName>;
const SCHEMA_FOR: Record<Job["kind"], z.ZodType<object>> = { EXTRACT: extractionSchema, SUMMARISE: summarySchema };

/** The user turn for a job: the data only. The instructions live in the system prompt. */
async function buildParts(job: Job & { document: Document }): Promise<Part[]> {
  if (job.kind === "SUMMARISE") {
    const extracted = await db.job.findFirst({
      where: { documentId: job.documentId, kind: "EXTRACT", status: "DONE" },
      orderBy: { createdAt: "desc" },
      select: { result: true },
    });
    if (!extracted?.result) throw new JobError("NOTHING_TO_SUMMARISE", "No successful extraction exists for this document.", false);
    return [{ text: JSON.stringify(extracted.result) }];
  }

  let bytes: Buffer;
  try {
    bytes = await storage.get(job.document.storageKey);
  } catch {
    throw new JobError("FILE_MISSING", `Stored file not found for key ${job.document.storageKey}.`, false);
  }
  if (job.document.mimeType === "application/pdf") {
    return [{ inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } }];
  }
  return [{ text: `<document>\n${bytes.toString("utf8")}\n</document>` }];
}

/**
 * Runs one attempt of one job. Always ends by writing the outcome to the job
 * row: DONE with a validated result, PENDING again for a retry, or FAILED
 * with the reason. It never throws, so one bad job cannot stop the worker.
 */
export async function processJob(jobId: string): Promise<void> {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { document: true } });
  if (!job || job.status !== "PROCESSING") return;

  const role = ROLE_FOR[job.kind];
  const settings = aiConfig.roles[role];
  // Defined fallback: after a timeout or provider error, the retry goes to the other model.
  const useFallback = job.attempts > 1 && (job.errorCode === "TIMEOUT" || job.errorCode === "PROVIDER_ERROR");
  const model = useFallback ? settings.fallbackModel : settings.model;

  try {
    const parts = await buildParts(job);
    // A retry after a rejected answer says what was wrong with it. Sending the
    // identical request again, at a low temperature, mostly buys the identical mistake.
    if (job.attempts > 1 && job.error && (job.errorCode === "INVALID_OUTPUT" || job.errorCode === "TRUNCATED")) {
      parts.push({ text: `Your previous reply was rejected by validation. ${job.error.replace(/^Attempt \d+ of \d+: /, "")} Reply again with a JSON object that matches the schema exactly.` });
    }
    const reply = await callModel({ role, model, parts, schema: toProviderSchema(SCHEMA_FOR[job.kind]) });

    // Keep the raw reply before judging it, so a rejected answer can be inspected later.
    await db.job.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: { model, rawOutput: reply.rawText, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
    });

    if (reply.finishReason === "MAX_TOKENS") {
      throw new JobError("TRUNCATED", `The reply was cut off at the ${settings.maxOutputTokens}-token output cap.`, true);
    }
    // Validation in our own code. A 200 from the provider proves a reply
    // arrived, not that the reply is usable.
    const checked = parseModelOutput(SCHEMA_FOR[job.kind], reply.rawText);
    if (!checked.ok) throw new JobError("INVALID_OUTPUT", checked.problem, true);

    await db.job.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: { status: "DONE", result: checked.data, errorCode: null, error: null, finishedAt: new Date(), lockedAt: null },
    });
  } catch (error) {
    const failure =
      error instanceof JobError
        ? error
        : error instanceof ModelCallError
          ? new JobError(error.code, error.message, error.retryable)
          : new JobError("PROVIDER_ERROR", error instanceof Error ? error.message : "Unknown error", true);
    await recordFailure(job, model, failure);
  }
}

/** Defined retry, then defined graceful failure. */
export async function recordFailure(job: Pick<Job, "id" | "attempts">, model: string | null, failure: JobError): Promise<void> {
  const { maxAttempts, retryBackoffMs } = aiConfig.jobs;
  const message = `Attempt ${job.attempts} of ${maxAttempts}: ${failure.message}`;
  const common = { model: model ?? undefined, errorCode: failure.code, error: message, lockedAt: null };

  if (failure.retryable && job.attempts < maxAttempts) {
    const wait = retryBackoffMs[Math.min(job.attempts - 1, retryBackoffMs.length - 1)];
    await db.job.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: { ...common, status: "PENDING", runAfter: new Date(Date.now() + wait) },
    });
  } else {
    await db.job.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: { ...common, status: "FAILED", finishedAt: new Date() },
    });
  }
}
