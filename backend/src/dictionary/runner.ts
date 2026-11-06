import { setTimeout as delay } from 'node:timers/promises';
import { GenerationError, type Generated } from './model';
import { DictionaryStore } from './store';

export async function runBuild(store: DictionaryStore, build: string,
  generator: { generate(word: string, signal?: AbortSignal): Promise<Generated> },
  options: { limit?: number; delayMs?: number; concurrency?: number; signal?: AbortSignal; emit?: (event: unknown) => void } = {}) {
  const limit = options.limit ?? 1000, pause = options.delayMs ?? 1000, concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000 || !Number.isSafeInteger(pause) || pause < 0 || pause > 60_000
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid run limits');
  store.config(build, true); store.acquire();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let leaseError: unknown;
  const heartbeat = setInterval(() => { try { store.heartbeat(); } catch (error) { leaseError = error; abort(); } }, 15_000);
  let completed = 0, claimed = 0, consecutiveFailures = 0;
  let stopped = 'limit-or-exhausted';
  const worker = async () => {
    while (claimed < limit && !controller.signal.aborted) {
      const job = store.reserve(build); if (!job) break;
      claimed++;
      let failure: GenerationError | undefined;
      let result: Generated | undefined;
      try { result = await generator.generate(job.word, controller.signal); }
      catch (error) { failure = error instanceof GenerationError ? error : new GenerationError('GENERATOR_ERROR'); }
      if (leaseError) throw leaseError;
      store.complete(build, job, result, failure);
      completed++; consecutiveFailures = result ? 0 : consecutiveFailures + 1;
      options.emit?.({ event: 'dictionary_attempt', completed, word: job.word, state: result ? 'draft' : 'failed',
        model: result?.model ?? failure?.observation?.model ?? null, error: failure?.code ?? null });
      // Stop on credentials/configuration faults, cancellation or a sustained outage.
      if (failure && (!failure.retryable || consecutiveFailures >= 5)) { stopped = 'provider-failures'; abort(); }
      if (controller.signal.aborted) break;
      if (claimed < limit) await delay(failure ? Math.max(pause, 2000 * consecutiveFailures) : pause, undefined,
        { signal: controller.signal }).catch(() => {});
    }
  };
  try {
    // Await all workers even if one fails: do not close SQLite while another finishes.
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker().catch(error => { abort(); throw error; })));
    const failed = workers.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return { completed, stopped: stopped === 'provider-failures' ? stopped : controller.signal.aborted ? 'cancelled' : stopped, ...store.status(build) };
  } finally { clearInterval(heartbeat); options.signal?.removeEventListener('abort', abort); store.release(); }
}
