/**
 * Bounded public read queue. A consumer abort only cancels the shared request
 * after the last consumer leaves. Failed/abandoned reads are never cached.
 */
export function createSharedReadCache<T>({ concurrency = 4, capacity = 128, ttlMs = 30_000 } = {}) {
  type Entry = {
    controller: AbortController;
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
    load: (signal: AbortSignal) => Promise<T>;
    users: number;
  };
  const cache = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Entry>();
  const queue: Array<{ key: string; entry: Entry }> = [];
  let active = 0;
  const abortError = () => new DOMException("Read cancelled", "AbortError");
  function pump() {
    while (active < concurrency && queue.length) {
      const { key, entry } = queue.shift()!;
      if (entry.controller.signal.aborted) continue;
      active++;
      void Promise.resolve().then(() => entry.load(entry.controller.signal)).then(
        (value) => {
          if (!entry.controller.signal.aborted) {
            cache.delete(key);
            cache.set(key, { value, expires: Date.now() + ttlMs });
            while (cache.size > capacity) cache.delete(cache.keys().next().value!);
            entry.resolve(value);
          }
        },
        (error: unknown) => {
          if (pending.get(key) === entry) pending.delete(key);
          entry.reject(error);
        },
      ).finally(() => {
        if (pending.get(key) === entry) pending.delete(key);
        active--;
        pump();
      });
    }
  }
  return function read(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    cache.delete(key);
    let entry = pending.get(key);
    if (!entry) {
      if (pending.size >= capacity) return Promise.reject(new Error("Read queue is full"));
      let resolve!: Entry["resolve"], reject!: Entry["reject"];
      const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      entry = { controller: new AbortController(), promise, resolve, reject, load, users: 0 };
      pending.set(key, entry);
      queue.push({ key, entry });
    }
    const request = entry;
    request.users++;
    const result = new Promise<T>((resolve, reject) => {
      let settled = false;
      const release = () => {
        settled = true;
        signal?.removeEventListener("abort", abort);
        request.users--;
      };
      const abort = () => {
        if (settled) return;
        release();
        reject(abortError());
        if (!request.users) {
          if (pending.get(key) === request) pending.delete(key);
          const index = queue.findIndex((item) => item.entry === request);
          if (index >= 0) queue.splice(index, 1);
          request.controller.abort();
          request.reject(abortError());
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      request.promise.then(
        (value) => { if (!settled) { release(); resolve(value); } },
        (error: unknown) => { if (!settled) { release(); reject(error); } },
      );
    });
    pump();
    return result;
  };
}
