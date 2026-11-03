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

  it("aborts the in-flight request when it times out", async () => {
    const queue = new AnalyticsQueue({ maxConcurrent: 1, timeoutMs: 100 });
    let capturedSignal: AbortSignal | null = null;
    let aborted = false;

    const request = queue.enqueue((signal) => {
      capturedSignal = signal;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => {});
    });
    const assertion = expect(request).rejects.toThrow(
      "Analytics request timed out after 100 ms",
    );

    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(true);
    expect(aborted).toBe(true);
  });

  it("rejects new requests when the pending queue is full", async () => {
    const queue = new AnalyticsQueue({
      maxConcurrent: 1,
      maxQueued: 1,
      timeoutMs: 1000,
    });
    let releaseFirst: (() => void) | null = null;

    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = queue.enqueue(() => Promise.resolve("second"));
    await Promise.resolve();

    await expect(queue.enqueue(() => Promise.resolve("third"))).rejects.toThrow(
      "Analytics queue is full (max 1 pending requests)",
    );

    expect(releaseFirst).not.toBeNull();
    releaseFirst!();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("second");
    expect(vi.getTimerCount()).toBe(0);
  });
});
