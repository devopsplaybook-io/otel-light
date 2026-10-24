import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsQueue } from "../services/AnalyticsQueue";

describe("AnalyticsQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out a hung request and releases the slot for the queue", async () => {
    const queue = new AnalyticsQueue({ maxConcurrent: 1, timeoutMs: 100 });
    let releaseHung: () => void = () => {};
    const hung = new Promise<void>((resolve) => {
      releaseHung = resolve;
    });

    const first = queue
      .enqueue(() => hung)
      .then(
        () => "first-resolved",
        (error) => error,
      );
    const second = queue.enqueue(() => Promise.resolve("second"));

    await vi.advanceTimersByTimeAsync(100);

    const timedOut = await first;
    expect(timedOut).toBeInstanceOf(Error);
    expect((timedOut as Error).message).toBe(
      "Analytics request timed out after 100 ms",
    );
    await expect(second).resolves.toBe("second");
    expect(vi.getTimerCount()).toBe(0);

    releaseHung();
  });

  it("clears the timeout timer when a request settles quickly", async () => {
    const queue = new AnalyticsQueue({ maxConcurrent: 1, timeoutMs: 1000 });

    await expect(queue.enqueue(() => Promise.resolve("fast"))).resolves.toBe(
      "fast",
    );

    expect(vi.getTimerCount()).toBe(0);
  });

  it("normalizes synchronous throws into rejections", async () => {
    const queue = new AnalyticsQueue({ maxConcurrent: 1, timeoutMs: 1000 });

    await expect(
      queue.enqueue(() => {
        throw new Error("sync failure");
      }),
    ).rejects.toThrow("sync failure");
  });
});
