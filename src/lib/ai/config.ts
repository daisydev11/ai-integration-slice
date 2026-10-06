// Every changeable value for the AI flow lives here. Nothing below is
// hardcoded in a handler or in the worker.

const MINUTE = 60 * 1000;

export const aiConfig = {
  // One entry per model role. The model is routed by task: the larger model
  // reads the raw document, the smaller one rewrites data that is already clean.
  roles: {
    extractor: {
      model: "gemini-3.8-flash",
      // Used for the retry after a timeout or a provider error.
      fallbackModel: "gemini-3.5-flash-lite",
      temperature: 0,
      maxOutputTokens: 4096,
      timeoutMs: 30_000,
    },
    summariser: {
      model: "gemini-3.5-flash-lite",
      fallbackModel: "gemini-3.8-flash",
      temperature: 0.4,
      maxOutputTokens: 1024,
      timeoutMs: 15_000,
    },
  },

  jobs: {
    // Maximum model calls in flight at once, across all users.
    concurrency: 2,
    // Total tries per job, including the first.
    maxAttempts: 3,
    // Wait before attempt 2, then before attempt 3.
    retryBackoffMs: [2_000, 8_000],
    // How often the worker looks for work when nothing wakes it.
    pollIntervalMs: 2_000,
    // A PROCESSING job untouched for this long is assumed lost (server restart).
    staleAfterMs: 2 * MINUTE,
  },

  upload: {
    maxFiles: 10,
    maxFileBytes: 1_000_000, // 1 MB
    // extension -> the MIME type we store and send to the model
    allowedTypes: { ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf" },
  },

  limits: {
    // Requests to the endpoint that triggers processing, per user.
    uploadsByUser: { max: 10, windowMs: 10 * MINUTE },
    // Requests to the follow-up action, per user.
    followUpsByUser: { max: 20, windowMs: 10 * MINUTE },
    // Hard ceiling on jobs one user can create in 24 hours. This is the cap
    // on total spend per account.
    jobsPerUserPerDay: 50,
  },

  // USD per 1 million tokens, from Google's Gemini API pricing page (paid
  // tier, read 6 October 2026). Used only to show an estimated cost.
  pricingPerMillionTokens: {
    "gemini-3.8-flash": { input: 0.75, output: 3.75 },
    "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  } as Record<string, { input: number; output: number }>,
} as const;

export type RoleName = keyof typeof aiConfig.roles;
