import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DocumentResult } from "@/components/documents/DocumentResult";
import { getSessionUser } from "@/lib/auth/session";
import { getDocumentView } from "@/lib/documents/service";

type Props = { params: Promise<{ id: string }> };

export default async function DocumentPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const document = await getDocumentView(user.id, (await params).id);
  if (!document) notFound();
  return (
    <div className="stack">
      <Link href="/documents">← All uploads</Link>
      <h1>{document.originalName}</h1>
      <DocumentResult initial={document} />
    </div>
  );
}
