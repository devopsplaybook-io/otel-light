import * as schedule from "node-schedule";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("ScheduledJobs");

const DEFAULT_POLL_MS = 1000;

// In-process mutex serializing the heavy scheduled jobs (maintenance, LLM
// recommendation, static reports) so they never run concurrently within one
// server process. Cross-process overlap is mitigated by staggered cron
// defaults plus jitter; there is no distributed lock.
let jobBusy = false;

export async function ScheduledJobRunExclusive(
  name: string,
  fn: () => Promise<void>,
  waitMinutes: number,
  pollMs = DEFAULT_POLL_MS,
): Promise<void> {
  const waitMs = Math.max(Number(waitMinutes) || 0, 0) * 60_000;
  const deadline = Date.now() + waitMs;
  while (jobBusy) {
    if (Date.now() >= deadline) {
      logger.warn(
        `Scheduled job "${name}" skipped: another heavy job is still running`,
      );
      return;
    }
    const sleepMs = Math.min(pollMs, Math.max(deadline - Date.now(), 1));
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  jobBusy = true;
  try {
    await fn();
  } finally {
    jobBusy = false;
  }
}

// Random delay in [0, minutes[ after a cron fire, spreading jobs that share a
// schedule and absorbing startup/clock alignment.
export function ScheduledJobComputeJitterMs(
  minutes: number,
  random: () => number = Math.random,
): number {
  const maxMs = Math.max(Number(minutes) || 0, 0) * 60_000;
  if (maxMs <= 0) {
    return 0;
  }
  return Math.floor(random() * maxMs);
}

export function ScheduledJobRunDelayed(
  name: string,
  delayMs: number,
  jitterMinutes: number,
  waitMinutes: number,
  run: () => Promise<void>,
): void {
  const totalDelayMs =
    Math.max(Number(delayMs) || 0, 0) +
    ScheduledJobComputeJitterMs(jitterMinutes);
  setTimeout(() => {
    ScheduledJobRunExclusive(name, run, waitMinutes).catch((err) =>
      logger.error(`Scheduled job "${name}" failed: ${err.message}`, err),
    );
  }, totalDelayMs).unref();
}

export function ScheduledJobRegisterCron(
  name: string,
  cronExpr: string,
  jitterMinutes: number,
  waitMinutes: number,
  run: () => Promise<void>,
): schedule.Job {
  return schedule.scheduleJob(cronExpr, () => {
    ScheduledJobRunDelayed(name, 0, jitterMinutes, waitMinutes, run);
  });
}
