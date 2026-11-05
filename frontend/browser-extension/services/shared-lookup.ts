export const lookupCancelled = () => new DOMException('Lookup cancelled', 'AbortError');
interface Flight<T> { controller: AbortController; promise: Promise<T>; subscribers: number }

/** Each caller owns one subscription; only its final departure aborts shared work. */
export class SharedLookup<T> {
  private flights = new Map<string, Flight<T>>();
  constructor(private timeoutMs: number, private timeoutMessage: string, private maximum = 128) {}
  run(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(lookupCancelled());
    let flight = this.flights.get(key);
    if (!flight) {
      if (this.flights.size >= this.maximum) return Promise.reject(new Error('Too many pending lookups. Please try again.'));
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      let aborted: () => void;
      const cancellation = new Promise<never>((_, reject) => {
        aborted = () => reject(controller.signal.reason ?? lookupCancelled());
        controller.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => controller.abort(new Error(this.timeoutMessage)), this.timeoutMs);
      });
      const task: Flight<T> = { controller, subscribers: 0, promise: undefined! };
      task.promise = Promise.race([
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }), cancellation,
      ]).finally(() => {
        clearTimeout(timer); controller.signal.removeEventListener('abort', aborted);
        if (this.flights.get(key) === task) this.flights.delete(key);
      });
      flight = task; this.flights.set(key, flight);
    }
    const task = flight; task.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', cancel);
        task.subscribers--;
        if (task.subscribers === 0 && this.flights.get(key) === task) {
          this.flights.delete(key); task.controller.abort(lookupCancelled());
        }
        if (error !== undefined) reject(error); else resolve(value!);
      };
      const cancel = () => finish(lookupCancelled());
      signal?.addEventListener('abort', cancel, { once: true });
      task.promise.then(value => signal?.aborted ? cancel() : finish(undefined, value), error => finish(error));
      if (signal?.aborted) cancel();
    });
  }
  clear() { for (const task of this.flights.values()) task.controller.abort(lookupCancelled()); this.flights.clear(); }
}
