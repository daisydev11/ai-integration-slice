import { aiConfig } from "@/lib/ai/config";

type JobState = { status: "PENDING" | "PROCESSING" | "DONE" | "FAILED"; attempts: number };

export const isInProgress = (status: string) => status === "PENDING" || status === "PROCESSING";

/** What is actually happening to a job right now, in words. No fake progress bar. */
export function describeStatus(job: JobState): { label: string; detail: string; tone: "waiting" | "working" | "done" | "failed" } {
  const max = aiConfig.jobs.maxAttempts;
  switch (job.status) {
    case "PENDING":
      return job.attempts === 0
        ? { label: "Pending", detail: "Waiting in the queue. Nothing has been sent to the AI yet.", tone: "waiting" }
        : { label: "Pending", detail: `Attempt ${job.attempts} of ${max} did not work. Waiting to try again.`, tone: "waiting" };
    case "PROCESSING":
      return { label: "Processing", detail: `With the AI now (attempt ${job.attempts} of ${max}).`, tone: "working" };
    case "DONE":
      return { label: "Done", detail: "Finished and checked.", tone: "done" };
    case "FAILED":
      return { label: "Failed", detail: `Could not be processed after ${job.attempts} ${job.attempts === 1 ? "attempt" : "attempts"}.`, tone: "failed" };
  }
}
