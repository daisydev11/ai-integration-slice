import { Prisma } from "@prisma/client";
import { aiConfig } from "@/lib/ai/config";
import { db, dbSchema } from "@/lib/db";
import { JobError } from "@/lib/jobs/errors";
import { processJob, recordFailure } from "@/lib/jobs/process";

// The background worker. It runs inside the server process, started once from
// src/instrumentation.ts. The queue is the Job table itself.
//
//   request handler:  INSERT a PENDING job, return 202 at once
//   worker:           claim the oldest PENDING jobs (FIFO), up to the
//                     concurrency cap, and run them

type WorkerState = { started: boolean; running: number; ticking: boolean; timer?: NodeJS.Timeout };
// Kept on globalThis so every copy of this module (Next.js can load more than
// one) shares the same counter. A second counter would mean a second cap.
const globalForWorker = globalThis as unknown as { jobWorker?: WorkerState };
const state = (globalForWorker.jobWorker ??= { started: false, running: 0, ticking: false });

const table = Prisma.raw(`"${dbSchema}"."Job"`);

/** Atomically moves up to `limit` due jobs from PENDING to PROCESSING, oldest first. */
async function claim(limit: number): Promise<string[]> {
  const now = new Date();
  // FOR UPDATE SKIP LOCKED: if two workers ever run this together, each gets
  // different rows instead of the same ones or a deadlock.
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE ${table} SET "status" = 'PROCESSING', "attempts" = "attempts" + 1,
           "lockedAt" = ${now}, "startedAt" = COALESCE("startedAt", ${now})
    WHERE "id" IN (
      SELECT "id" FROM ${table}
      WHERE "status" = 'PENDING' AND "runAfter" <= ${now}
      ORDER BY "createdAt", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows.map((r) => r.id);
}

/** Jobs left PROCESSING by a server that stopped are put back, or failed if out of attempts. */
async function recoverLostJobs(): Promise<void> {
  const lost = await db.job.findMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - aiConfig.jobs.staleAfterMs) } },
    select: { id: true, attempts: true, model: true },
  });
  for (const job of lost) {
    await recordFailure(job, job.model, new JobError("WORKER_LOST", "The server stopped while this was processing.", true));
  }
}

async function tick(): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    await recoverLostJobs();
    // THE CONCURRENCY CAP: never claim more than the free slots.
    const free = aiConfig.jobs.concurrency - state.running;
    if (free <= 0) return;
    for (const id of await claim(free)) {
      state.running++;
      void processJob(id)
        .catch((error) => console.error("[worker] job crashed", id, error))
        .finally(() => {
          state.running--;
          void tick(); // a slot is free: look for the next job straight away
        });
    }
  } catch (error) {
    console.error("[worker] tick failed", error);
  } finally {
    state.ticking = false;
  }
}

/** Starts the polling loop once per process. Safe to call repeatedly. */
export function startWorker(): void {
  if (state.started) return;
  state.started = true;
  state.timer = setInterval(() => void tick(), aiConfig.jobs.pollIntervalMs);
  state.timer.unref?.();
  void tick();
}

/** Called after a job is inserted, so it does not wait for the next poll. */
export function wakeWorker(): void {
  startWorker();
  void tick();
}
