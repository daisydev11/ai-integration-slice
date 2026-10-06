import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import { crossSiteRequest, errorResponse, limited, requireUser } from "@/lib/http";
import { getDocumentView, queueJob, remainingJobsToday } from "@/lib/documents/service";

type Context = { params: Promise<{ id: string }> };

/** The user-triggered follow-up: summarise the extracted requirements for a candidate. */
export async function POST(request: Request, { params }: Context) {
  const blocked = crossSiteRequest(request);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const tooMany = await limited("followup-user", auth.user.id, aiConfig.limits.followUpsByUser);
  if (tooMany) return tooMany;

  const document = await getDocumentView(auth.user.id, (await params).id);
  if (!document) return errorResponse(404, "NOT_FOUND", "No such document.");
  const extracted = document.extract?.status === "DONE" ? (document.extract.result as { isJobDescription?: boolean }) : null;
  if (!extracted?.isJobDescription) {
    return errorResponse(409, "NOTHING_TO_SUMMARISE", "This document has no extracted requirements to summarise.");
  }
  // The summary already exists: return it as done rather than paying the model
  // to write it again.
  if (document.summary?.status === "DONE") {
    return NextResponse.json({ ok: true, jobId: document.summary.id, alreadyDone: true });
  }
  if ((await remainingJobsToday(auth.user.id)) <= 0) {
    return errorResponse(429, "DAILY_LIMIT", `You have reached today's limit of ${aiConfig.limits.jobsPerUserPerDay} AI tasks. Try again tomorrow.`);
  }

  const jobId = await queueJob(auth.user.id, document.id, "SUMMARISE");
  // null = a summary is already queued or running; that is the same outcome for the user.
  return NextResponse.json({ ok: true, jobId, alreadyQueued: jobId === null }, { status: 202 });
}
