"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allowedExtensions, checkNameAndSize, uploadRules } from "@/lib/documents/rules";

type Rejected = { name: string; reason: string };

export function UploadForm() {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setRejected([]);
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return setError("Choose at least one file.");
    if (files.length > uploadRules.maxFiles) return setError(`Upload at most ${uploadRules.maxFiles} files at a time.`);

    // Same rules the server applies, checked here first so obviously bad
    // files are reported without an upload. The server checks again, and
    // also inspects the contents.
    const locallyRejected: Rejected[] = [];
    const body = new FormData();
    for (const file of files) {
      const reason = checkNameAndSize(file.name, file.size);
      if (reason) locallyRejected.push({ name: file.name, reason });
      else body.append("files", file);
    }
    if (!body.has("files")) return setRejected(locallyRejected);

    setPending(true);
    try {
      const response = await fetch("/api/documents", { method: "POST", body });
      const data = await response.json().catch(() => null);
      setRejected([...locallyRejected, ...(data?.rejected ?? [])]);
      if (response.status === 202) {
        const count = data.accepted.length;
        setMessage(`${count} ${count === 1 ? "file" : "files"} uploaded and queued. Processing happens in the background; you can leave this page.`);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else if (!data?.rejected?.length) {
        setError(data?.error?.message ?? "The upload failed. Nothing was processed.");
      }
    } catch {
      setError("Could not reach the server. Nothing was uploaded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor={inputId}>Job description files</label>
        <input ref={inputRef} id={inputId} type="file" multiple accept={allowedExtensions.join(",")} aria-describedby={hintId} />
        <p id={hintId} className="hint">
          {allowedExtensions.join(", ")} · up to {uploadRules.maxFileBytes / 1_000_000} MB each · up to {uploadRules.maxFiles} files at a time
        </p>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {rejected.length > 0 && (
        <div className="alert" role="alert">
          <p>Not accepted:</p>
          <ul>
            {rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.name}</strong>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload and process"}
      </button>
    </form>
  );
}
