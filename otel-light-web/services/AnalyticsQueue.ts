import axios from "axios";

interface QueueItem {
  requestFn: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  priority: boolean;
  onStart?: () => void;
}

export interface AnalyticsQueueOptions {
  maxConcurrent?: number;
  maxQueued?: number;
  timeoutMs?: number;
}

export interface AnalyticsEnqueueOptions {
  /** Insert before the first non-priority queued item (FIFO among priority items). */
  priority?: boolean;
  /** Called when a slot is taken, immediately before the request starts. */
  onStart?: () => void;
}

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_QUEUED = 100;
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
  private readonly maxQueued: number;
  private readonly timeoutMs: number;

  constructor(options: AnalyticsQueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  enqueue<T>(
    requestFn: (signal: AbortSignal) => Promise<T>,
    options: AnalyticsEnqueueOptions = {},
  ): Promise<T> {
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(
        new Error(
          `Analytics queue is full (max ${this.maxQueued} pending requests)`,
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem = {
        requestFn,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority: options.priority === true,
        onStart: options.onStart,
      };
      if (item.priority) {
        const index = this.queue.findIndex((queued) => !queued.priority);
        if (index === -1) {
          this.queue.push(item);
        } else {
          this.queue.splice(index, 0, item);
        }
      } else {
        this.queue.push(item);
      }
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;
      const controller = new AbortController();

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
        controller.abort();
        settle(() =>
          item.reject(
            new Error(
              `Analytics request timed out after ${this.timeoutMs} ms`,
            ),
          ),
        );
      }, this.timeoutMs);

      Promise.resolve()
        .then(() => {
          try {
            item.onStart?.();
          } catch {
            // A UI callback must never break the queue.
          }
          return item.requestFn(controller.signal);
        })
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
  options?: AnalyticsEnqueueOptions,
): Promise<any> {
  return analyticsQueue.enqueue(
    (signal) => axios.get(url, { ...config, signal }),
    options,
  );
}

/**
 * Drop-in replacement for `fetch` that queues requests targeting
 * analytics endpoints. Only 4 concurrent requests are allowed.
 */
export function analyticsFetch(
  url: string,
  init?: RequestInit,
  options?: AnalyticsEnqueueOptions,
): Promise<Response> {
  return analyticsQueue.enqueue(
    (signal) => fetch(url, { ...init, signal }),
    options,
  );
}
