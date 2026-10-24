jest.mock("./OTelContext", () => {
  const moduleLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    OTelLogger: () => ({ createModuleLogger: () => moduleLogger }),
  };
});

import {
  ScheduledJobComputeJitterMs,
  ScheduledJobRunExclusive,
} from "./ScheduledJobs";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("ScheduledJobRunExclusive", () => {
  it("serializes overlapping runs instead of executing them concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const job = async (durationMs: number): Promise<void> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(durationMs);
      active--;
    };

    await Promise.all([
      ScheduledJobRunExclusive("job-a", () => job(60), 0.05, 5),
      ScheduledJobRunExclusive("job-b", () => job(10), 0.05, 5),
    ]);

    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it("skips a job whose wait deadline expires while another job is running", async () => {
    let release: (() => void) | undefined;
    const first = ScheduledJobRunExclusive(
      "long-job",
      () => new Promise<void>((resolve) => (release = resolve)),
      0,
      5,
    );
    await sleep(10); // let the first job acquire the mutex

    const skipped = jest.fn(async () => undefined);
    await ScheduledJobRunExclusive("skipped-job", skipped, 0, 5);

    expect(skipped).not.toHaveBeenCalled();
    release?.();
    await first;
  });

  it("releases the mutex when a job throws", async () => {
    await expect(
      ScheduledJobRunExclusive(
        "failing-job",
        async () => {
          throw new Error("boom");
        },
        0,
        5,
      ),
    ).rejects.toThrow("boom");

    const next = jest.fn(async () => undefined);
    await ScheduledJobRunExclusive("next-job", next, 0, 5);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("ScheduledJobComputeJitterMs", () => {
  it("returns 0 when jitter is disabled", () => {
    expect(ScheduledJobComputeJitterMs(0)).toBe(0);
    expect(ScheduledJobComputeJitterMs(-5)).toBe(0);
  });

  it("returns a delay within [0, minutes)", () => {
    expect(ScheduledJobComputeJitterMs(5, () => 0)).toBe(0);
    expect(ScheduledJobComputeJitterMs(5, () => 0.5)).toBe(150_000);
    const upper = ScheduledJobComputeJitterMs(5, () => 0.999999);
    expect(upper).toBeGreaterThan(0);
    expect(upper).toBeLessThan(300_000);
  });
});
