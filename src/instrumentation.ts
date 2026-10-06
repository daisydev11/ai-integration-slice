// Next.js runs register() once when the server process starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/jobs/worker");
    startWorker();
  }
}
