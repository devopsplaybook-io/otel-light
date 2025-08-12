export class PromisePool {
  private maxConcurrency: number;
  private currentConcurrency: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: any[];
  private timeout: number;

  constructor(maxConcurrency, timeout = 3600000) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = 0;
    this.queue = [];
    this.timeout = timeout;
  }

  public add(promiseGenerator) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const signal = controller.signal;

      const wrappedPromise = () => {
        return new Promise((innerResolve, innerReject) => {
          const timeoutId = setTimeout(() => {
            controller.abort();
            innerReject(new Error("Promise cancelled due to timeout"));
          }, this.timeout);

          promiseGenerator(signal)
            .then((result) => {
              clearTimeout(timeoutId);
              innerResolve(result);
            })
            .catch((error) => {
              clearTimeout(timeoutId);
              innerReject(error);
            });
        });
      };

      this.queue.push({ wrappedPromise, resolve, reject });
      this.runNext();
    });
  }

  private runNext() {
    if (this.currentConcurrency < this.maxConcurrency && this.queue.length > 0) {
      const { wrappedPromise, resolve, reject } = this.queue.shift();
      this.currentConcurrency++;

      wrappedPromise()
        .then((result) => {
          resolve(result);
          this.currentConcurrency--;
          this.runNext();
        })
        .catch((error) => {
          reject(error);
          this.currentConcurrency--;
          this.runNext();
        });
    }
  }
}
