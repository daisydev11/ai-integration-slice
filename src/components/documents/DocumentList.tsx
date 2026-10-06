"use client";

import Link from "next/link";
import { describeStatus, isInProgress } from "@/components/documents/status";
import { usePolling } from "@/components/documents/usePolling";
import type { DocumentListItem } from "@/lib/documents/service";

const pick = (json: unknown) => (json as { documents?: DocumentListItem[] }).documents;
const anyInProgress = (documents: DocumentListItem[]) => documents.some((d) => isInProgress(d.status));

export function DocumentList({ initial }: { initial: DocumentListItem[] }) {
  const documents = usePolling("/api/documents", initial, pick, anyInProgress);

  if (documents.length === 0) {
    return <p className="lede">Nothing uploaded yet. Results will appear here.</p>;
  }
  return (
    <ul className="doc-list" aria-live="polite">
      {documents.map((document) => {
        const status = describeStatus(document);
        return (
          <li key={document.id}>
            <Link href={`/documents/${document.id}`}>{document.originalName}</Link>
            <span className={`status status-${status.tone}`}>{status.label}</span>
            <span className="hint">{status.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
