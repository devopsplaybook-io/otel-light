import axios from "axios";

interface QueueItem {
  requestFn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Bounded-concurrency queue for analytics API requests (traces, logs, metrics).
 * Only 2 requests execute concurrently. Failed / timed-out requests are
 * released from the active slot immediately so queued requests can proceed.
 */
class AnalyticsQueue {
  private readonly queue: QueueItem[] = [];
  private activeCount = 0;
  private readonly maxConcurrent = 2;

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
      item
        .requestFn()
        .then((result) => item.resolve(result))
        .catch((error) => item.reject(error))
        .finally(() => {
          this.activeCount--;
          this.processQueue();
        });
    }
  }
}

/** Singleton queue instance shared across the app */
export const analyticsQueue = new AnalyticsQueue();

/**
 * Drop-in replacement for `axios.get` that queues requests targeting
 * analytics endpoints (traces, logs, metrics). Only 2 concurrent
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
 * analytics endpoints. Only 2 concurrent requests are allowed.
 */
export function analyticsFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return analyticsQueue.enqueue(() => fetch(url, init));
}
