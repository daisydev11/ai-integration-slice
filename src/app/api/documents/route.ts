import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";
import { crossSiteRequest, errorResponse, limited, requireUser } from "@/lib/http";
import { acceptUploads, listDocumentViews } from "@/lib/documents/service";

/** The signed-in user's documents with their current status. Polled by the list. */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  return NextResponse.json({ documents: await listDocumentViews(auth.user.id) });
}

/**
 * Upload. This is the endpoint that triggers processing, so it is rate
 * limited. It answers 202 Accepted: the files are stored and queued, and the
 * work itself happens in the background worker.
 */
export async function POST(request: Request) {
  const blocked = crossSiteRequest(request);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const tooMany = await limited("upload-user", auth.user.id, aiConfig.limits.uploadsByUser);
  if (tooMany) return tooMany;

  const { maxFiles, maxFileBytes } = aiConfig.upload;
  // Refuse an oversized body from its declared length, before reading it into memory.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxFiles * maxFileBytes + 100_000) {
    return errorResponse(413, "TOO_LARGE", `Upload at most ${maxFiles} files of ${maxFileBytes / 1_000_000} MB each.`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "INVALID_FORM", "Send the files as multipart form data in a field named \"files\".");
  }
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return errorResponse(422, "NO_FILES", "Choose at least one file.");
  if (files.length > maxFiles) return errorResponse(422, "TOO_MANY_FILES", `Upload at most ${maxFiles} files at a time.`);

  const outcome = await acceptUploads(auth.user.id, files);
  if (outcome.accepted.length === 0) {
    return NextResponse.json({ error: { code: "ALL_REJECTED", message: "None of the files could be accepted." }, ...outcome }, { status: 422 });
  }
  return NextResponse.json({ ok: true, ...outcome }, { status: 202 });
}
