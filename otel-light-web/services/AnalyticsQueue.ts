import axios from "axios";

interface QueueItem {
  requestFn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface AnalyticsQueueOptions {
  maxConcurrent?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Bounded-concurrency queue for analytics API requests (traces, logs, metrics).
 * Only 4 requests execute concurrently: enough for metric charts to load in
 * parallel, while still bounding server memory (each in-flight response is
 * buffered, compressed and decompressed). Server-side downsampling
 * (maxPoints) keeps individual responses small. Failed / timed-out requests
 * are released from the active slot immediately so queued requests can
 * proceed.
 */
export class AnalyticsQueue {
  private readonly queue: QueueItem[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;

  constructor(options: AnalyticsQueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  enqueue<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        requestFn,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;

      const state: {
        settled: boolean;
        timer: ReturnType<typeof setTimeout> | null;
      } = { settled: false, timer: null };
      const settle = (action: () => void) => {
        if (state.settled) return;
        state.settled = true;
        if (state.timer) {
          clearTimeout(state.timer);
        }
        this.activeCount--;
        action();
        this.processQueue();
      };

      state.timer = setTimeout(() => {
        settle(() =>
          item.reject(
            new Error(
              `Analytics request timed out after ${this.timeoutMs} ms`,
            ),
          ),
        );
      }, this.timeoutMs);

      Promise.resolve()
        .then(() => item.requestFn())
        .then((result) => settle(() => item.resolve(result)))
        .catch((error) => settle(() => item.reject(error)));
    }
  }
}

/** Singleton queue instance shared across the app */
export const analyticsQueue = new AnalyticsQueue();

/**
 * Drop-in replacement for `axios.get` that queues requests targeting
 * analytics endpoints (traces, logs, metrics). Only 4 concurrent
 * requests are allowed.
 */
export function analyticsGet(
  url: string,
  config?: Record<string, unknown>,
): Promise<any> {
  return analyticsQueue.enqueue(() => axios.get(url, config));
}

/**
 * Drop-in replacement for `fetch` that queues requests targeting
 * analytics endpoints. Only 4 concurrent requests are allowed.
 */
export function analyticsFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return analyticsQueue.enqueue(() => fetch(url, init));
}
