import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/http";
import { getDocumentView } from "@/lib/documents/service";

type Context = { params: Promise<{ id: string }> };

/** One document and its jobs. Polled by the result view while work is in progress. */
export async function GET(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const document = await getDocumentView(auth.user.id, (await params).id);
  if (!document) return errorResponse(404, "NOT_FOUND", "No such document.");
  return NextResponse.json({ document });
}
