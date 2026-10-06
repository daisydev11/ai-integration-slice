import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import { crossSiteRequest, errorResponse, limited, requireUser } from "@/lib/http";
import { getDocumentView, queueJob, remainingJobsToday } from "@/lib/documents/service";

type Context = { params: Promise<{ id: string }> };

/** "Try again" on a failed extraction. Queues a new job; the failed one stays as a record. */
export async function POST(request: Request, { params }: Context) {
  const blocked = crossSiteRequest(request);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (auth.response) return auth.response;
  // Same limit as uploading: both trigger a full processing run.
  const tooMany = await limited("upload-user", auth.user.id, aiConfig.limits.uploadsByUser);
  if (tooMany) return tooMany;

  const document = await getDocumentView(auth.user.id, (await params).id);
  if (!document) return errorResponse(404, "NOT_FOUND", "No such document.");
  if (document.extract?.status !== "FAILED") return errorResponse(409, "NOT_FAILED", "Only a failed document can be tried again.");
  if ((await remainingJobsToday(auth.user.id)) <= 0) {
    return errorResponse(429, "DAILY_LIMIT", `You have reached today's limit of ${aiConfig.limits.jobsPerUserPerDay} AI tasks. Try again tomorrow.`);
  }

  const jobId = await queueJob(auth.user.id, document.id, "EXTRACT");
  return NextResponse.json({ ok: true, jobId, alreadyQueued: jobId === null }, { status: 202 });
}
