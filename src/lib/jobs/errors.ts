// Every way a job can fail, with a stable code. The code is stored on the job
// row; the interface turns it into a designed explanation (see explainFailure).

export type JobErrorCode =
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "PROVIDER_REJECTED"
  | "NO_API_KEY"
  | "INVALID_OUTPUT"
  | "TRUNCATED"
  | "FILE_MISSING"
  | "NOTHING_TO_SUMMARISE"
  | "WORKER_LOST";

export class JobError extends Error {
  constructor(
    public code: JobErrorCode,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

type Explanation = { title: string; body: string; canRetry: boolean };

/** What the user is told for each failure. Honest about what happened and what they can do. */
export function explainFailure(code: string | null, attempts: number): Explanation {
  const tries = attempts === 1 ? "once" : `${attempts} times`;
  switch (code) {
    case "TIMEOUT":
      return { title: "The AI service took too long", body: `We tried ${tries} and did not get an answer in time. Your file is saved. This is usually temporary.`, canRetry: true };
    case "PROVIDER_ERROR":
      return { title: "The AI service had a problem", body: `We tried ${tries} and the AI service returned an error each time. Your file is saved. This is usually temporary.`, canRetry: true };
    case "INVALID_OUTPUT":
    case "TRUNCATED":
      return { title: "We could not get a usable result", body: `The AI answered ${tries}, but each answer failed our checks, so we have not shown it. Nothing is wrong with your account. Trying again may work; a shorter or cleaner file often helps.`, canRetry: true };
    case "PROVIDER_REJECTED":
      return { title: "The AI service could not read this file", body: "It refused the file as sent. This usually means the file is damaged or in a layout it cannot open. Try exporting it again, or upload it as plain text.", canRetry: false };
    case "FILE_MISSING":
      return { title: "The uploaded file is no longer available", body: "We could not find the stored file for this document. Please upload it again.", canRetry: false };
    case "NO_API_KEY":
      return { title: "The AI service is not configured", body: "This server has no API key for the AI service, so nothing was sent. Once the key is added, try again.", canRetry: true };
    case "NOTHING_TO_SUMMARISE":
      return { title: "There is nothing to summarise yet", body: "The requirements for this document have not been extracted successfully.", canRetry: false };
    case "WORKER_LOST":
      return { title: "Processing was interrupted", body: "The server restarted while this was being processed and it ran out of attempts. Your file is saved.", canRetry: true };
    default:
      return { title: "Something went wrong", body: "This could not be processed. Your file is saved.", canRetry: true };
  }
}
