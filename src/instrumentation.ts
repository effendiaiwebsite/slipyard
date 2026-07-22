/**
 * Next.js instrumentation hook — runs once per server instance, before it
 * serves requests. This is where the M5 pg-boss job runner comes up, so
 * `pnpm dev`, `next start`, and the Playwright web server all process jobs
 * without a separate worker process to operate. JOBS_ENABLED=false opts out.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobs } = await import("@/lib/jobs");
    await startJobs();
  }
}
