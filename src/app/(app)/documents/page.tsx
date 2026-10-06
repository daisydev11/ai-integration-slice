import { redirect } from "next/navigation";
import { DocumentList } from "@/components/documents/DocumentList";
import { UploadForm } from "@/components/documents/UploadForm";
import { getSessionUser } from "@/lib/auth/session";
import { listDocumentViews } from "@/lib/documents/service";

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return (
    <div className="stack">
      <h1>Job descriptions</h1>
      <p className="lede">Upload job descriptions and get their requirements as structured data.</p>
      <UploadForm />
      <h2>Your uploads</h2>
      <DocumentList initial={await listDocumentViews(user.id)} />
    </div>
  );
}
