import { ServiceUnavailableException } from '@nestjs/common';

/** Process-local, bounded cache/queue for public display data only. */
export class MarketReadCache<T> {
  private readonly values = new Map<string, { value: T; expires: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly queue: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly ttlMs = 30_000,
    private readonly capacity = 256,
    private readonly concurrency = 8,
    private readonly maxPending = 64,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now())
      return Promise.resolve(cached.value);
    this.values.delete(key);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(
        new ServiceUnavailableException('Market chart service is busy'),
      );
    }
    const request = new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        void Promise.resolve()
          .then(load)
          .then(
            (value) => {
              this.values.set(key, { value, expires: Date.now() + this.ttlMs });
              while (this.values.size > this.capacity) {
                const oldest = this.values.keys().next();
                if (oldest.done) break;
                this.values.delete(oldest.value);
              }
              resolve(value);
            },
            (error: unknown) => {
              this.pending.delete(key);
              reject(
                error instanceof Error
                  ? error
                  : new Error('Market chart unavailable'),
              );
            },
          )
          .finally(() => {
            if (this.pending.get(key) === request) this.pending.delete(key);
            this.active--;
            this.pump();
          });
      });
    });
    this.pending.set(key, request);
    this.pump();
    return request;
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length)
      this.queue.shift()!();
  }
}
