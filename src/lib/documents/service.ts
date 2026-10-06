import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { aiConfig } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { checkFile } from "@/lib/documents/validate";
import { wakeWorker } from "@/lib/jobs/worker";
import { storage } from "@/lib/storage";

export type UploadOutcome = {
  accepted: { documentId: string; jobId: string; name: string }[];
  rejected: { name: string; reason: string }[];
};

/** Jobs this user may still create today. The per-account spend ceiling. */
export async function remainingJobsToday(userId: string): Promise<number> {
  const used = await db.job.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  return Math.max(0, aiConfig.limits.jobsPerUserPerDay - used);
}

/**
 * Checks each file, stores the good ones, and queues one EXTRACT job per file.
 * No model is called here: the request returns as soon as the jobs exist.
 */
export async function acceptUploads(userId: string, files: File[]): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { accepted: [], rejected: [] };
  let allowance = await remainingJobsToday(userId);

  for (const file of files) {
    const name = file.name.slice(0, 200) || "unnamed";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkFile(name, bytes);
    if (!checked.ok) {
      outcome.rejected.push({ name, reason: checked.reason });
      continue;
    }
    if (allowance <= 0) {
      outcome.rejected.push({ name, reason: `You have reached today's limit of ${aiConfig.limits.jobsPerUserPerDay} documents. Try again tomorrow.` });
      continue;
    }
    allowance--;

    // The key is random, never the user's file name, so names cannot collide or traverse paths.
    const storageKey = `documents/${userId}/${randomBytes(16).toString("hex")}${checked.extension}`;
    await storage.put(storageKey, bytes);
    const document = await db.document.create({
      data: {
        userId,
        originalName: name,
        mimeType: checked.mimeType,
        sizeBytes: bytes.byteLength,
        storageKey,
        jobs: { create: { userId, kind: "EXTRACT" } },
      },
      select: { id: true, jobs: { select: { id: true } } },
    });
    outcome.accepted.push({ documentId: document.id, jobId: document.jobs[0].id, name });
  }

  if (outcome.accepted.length > 0) wakeWorker();
  return outcome;
}

/** Queues a job for an existing document. Returns null if one of that kind is already waiting or running. */
export async function queueJob(userId: string, documentId: string, kind: "EXTRACT" | "SUMMARISE"): Promise<string | null> {
  try {
    const job = await db.job.create({ data: { userId, documentId, kind }, select: { id: true } });
    wakeWorker();
    return job.id;
  } catch (error) {
    // The partial unique index refused a second active job of this kind.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

const jobView = { id: true, kind: true, status: true, attempts: true, model: true, errorCode: true, result: true, inputTokens: true, outputTokens: true, createdAt: true, finishedAt: true } as const;

/** One document with its latest job of each kind. Scoped to the owner in the query itself. */
export async function getDocumentView(userId: string, documentId: string) {
  const document = await db.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true, originalName: true, sizeBytes: true, createdAt: true, jobs: { orderBy: { createdAt: "desc" }, select: jobView } },
  });
  if (!document) return null;
  const { jobs, ...rest } = document;
  return {
    ...rest,
    extract: jobs.find((j) => j.kind === "EXTRACT") ?? null,
    summary: jobs.find((j) => j.kind === "SUMMARISE") ?? null,
  };
}

export async function listDocumentViews(userId: string) {
  const documents = await db.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, originalName: true, createdAt: true, jobs: { where: { kind: "EXTRACT" }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, attempts: true, errorCode: true } } },
  });
  return documents.map(({ jobs, ...d }) => ({ ...d, status: jobs[0]?.status ?? "FAILED", attempts: jobs[0]?.attempts ?? 0, errorCode: jobs[0]?.errorCode ?? null }));
}

export type DocumentView = NonNullable<Awaited<ReturnType<typeof getDocumentView>>>;
export type DocumentListItem = Awaited<ReturnType<typeof listDocumentViews>>[number];
