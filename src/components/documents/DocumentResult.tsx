"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { describeStatus, isInProgress } from "@/components/documents/status";
import { usePolling } from "@/components/documents/usePolling";
import type { Extraction, Summary } from "@/lib/ai/schemas";
import type { DocumentView } from "@/lib/documents/service";
import { explainFailure } from "@/lib/jobs/errors";

type JobView = NonNullable<DocumentView["extract"]>;

const pick = (json: unknown) => (json as { document?: DocumentView }).document;
const inProgress = (d: DocumentView) => [d.extract, d.summary].some((job) => job && isInProgress(job.status));
const label = (value: string) => value.replaceAll("_", " ");

function useTrigger(url: string, onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.ok) onDone();
      else setError(data?.error?.message ?? "That did not work. Nothing was started.");
    } catch {
      setError("Could not reach the server. Nothing was started.");
    } finally {
      setPending(false);
    }
  }, [url, onDone]);
  return { run, pending, error };
}

function Progress({ job, what }: { job: JobView; what: string }) {
  const status = describeStatus(job);
  return (
    <div className="panel" role="status">
      <p>
        <span className={`status status-${status.tone}`}>{status.label}</span> {what}
      </p>
      <p className="hint">{status.detail} This page updates by itself.</p>
    </div>
  );
}

function Failure({ job, retry }: { job: JobView; retry?: ReturnType<typeof useTrigger> }) {
  const explained = explainFailure(job.errorCode, job.attempts);
  return (
    <div className="panel failure stack">
      <h2>{explained.title}</h2>
      <p>{explained.body}</p>
      {retry?.error && (
        <p className="alert" role="alert">
          {retry.error}
        </p>
      )}
      {explained.canRetry && retry && (
        <button type="button" onClick={retry.run} disabled={retry.pending}>
          {retry.pending ? "Queuing…" : "Try again"}
        </button>
      )}
    </div>
  );
}

function Items({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

export function DocumentResult({ initial }: { initial: DocumentView }) {
  const router = useRouter();
  const document = usePolling(`/api/documents/${initial.id}`, initial, pick, inProgress);
  const refresh = useCallback(() => router.refresh(), [router]);
  const retry = useTrigger(`/api/documents/${document.id}/retry`, refresh);
  const summarise = useTrigger(`/api/documents/${document.id}/summarise`, refresh);
  const { extract, summary } = document;

  if (!extract) return <p className="lede">This document has not been queued.</p>;
  if (isInProgress(extract.status)) return <Progress job={extract} what="Extracting the requirements." />;
  if (extract.status === "FAILED") return <Failure job={extract} retry={retry} />;

  const result = extract.result as Extraction;
  if (!result.isJobDescription) {
    return (
      <div className="panel stack">
        <h2>This does not look like a job description</h2>
        <p>The file was read successfully, but it does not describe a job, so there are no requirements to show.</p>
      </div>
    );
  }

  const summaryResult = summary?.status === "DONE" ? (summary.result as Summary) : null;
  return (
    <div className="stack result">
      <dl className="facts">
        {(
          [
            ["Role", result.title],
            ["Company", result.company],
            ["Location", result.location],
            ["Work mode", label(result.workMode)],
            ["Type", label(result.employmentType)],
            ["Level", label(result.seniority)],
            ["Experience", result.minYearsExperience === null ? null : `${result.minYearsExperience}+ years`],
          ] as const
        ).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value ?? <span className="muted">Not stated</span>}</dd>
          </div>
        ))}
      </dl>
      <Items title="Must have" items={result.mustHave} />
      <Items title="Nice to have" items={result.niceToHave} />
      <Items title="Responsibilities" items={result.responsibilities} />

      <section className="stack followup">
        <h2>Summary for a candidate</h2>
        {summaryResult ? (
          <div className="panel stack">
            <p>
              <strong>{summaryResult.headline}</strong>
            </p>
            <p>{summaryResult.summary}</p>
            {summaryResult.questionsToAsk.length > 0 && (
              <>
                <p className="hint">Questions worth asking</p>
                <ul>
                  {summaryResult.questionsToAsk.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : summary && isInProgress(summary.status) ? (
          <Progress job={summary} what="Writing the summary." />
        ) : (
          <>
            {summary?.status === "FAILED" && <Failure job={summary} />}
            {summarise.error && (
              <p className="alert" role="alert">
                {summarise.error}
              </p>
            )}
            <button type="button" onClick={summarise.run} disabled={summarise.pending}>
              {summarise.pending ? "Queuing…" : summary?.status === "FAILED" ? "Try the summary again" : "Summarise for a candidate"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
