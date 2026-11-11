import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { responseRoute } from '../magpie-observation';
import { PROMPT, hash, parseEntry, GenerationError, type BuildConfig, type Generated, type LexicalReference, type Usage } from './model';
import { DictionaryStore } from './store';

export const BATCH_PROMPT = `${PROMPT}\nBatch envelope: the user supplies {items:[{word,reference},...]}. Apply ALL the preceding per-entry rules independently to each item. Return ONLY {"entries":[entry,...]} with exactly one entry per requested lowercase word, no duplicates or extra words. Each entry has exactly word, forms, senses. Do not put editing notes inside definitions or collocations.`;
export const BATCH_PROMPT_HASH = hash(BATCH_PROMPT);
function emptyPlaceholder(value: unknown): boolean {
  return value === null || typeof value === 'string' && !value.trim()
    || Array.isArray(value) && value.length === 0
    || value !== null && typeof value === 'object' && Object.keys(value).length === 0;
}
/** Canonical formatting only; no meanings, examples or missing senses are invented. */
export function normalizeBatchEntry(value: unknown, word: string, reference?: LexicalReference): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entry = { ...value } as Record<string, unknown>;
  for (const [key, field] of Object.entries(entry)) {
    if (!['word', 'forms', 'senses'].includes(key) && emptyPlaceholder(field)) delete entry[key];
  }
  if (reference && entry.reference && typeof entry.reference === 'object' && !Array.isArray(entry.reference)) {
    const echo = entry.reference as Record<string, unknown>, keys = Object.keys(echo);
    if (keys.length && keys.every(key => Object.hasOwn(reference, key)
      && JSON.stringify(echo[key]) === JSON.stringify(reference[key as keyof LexicalReference]))) delete entry.reference;
  }
  if (entry.word === word || word === 'i' && entry.word === 'I'
    || word.length > 2 && entry.word === word[0].toUpperCase() + word.slice(1)) entry.word = word;
  if (Array.isArray(entry.forms)) entry.forms = [...new Set(entry.forms.map(form => {
    if (typeof form !== 'string') return form;
    const trimmed = form.trim(), lower = trimmed.toLowerCase();
    return lower.startsWith(word) && trimmed === lower[0]?.toUpperCase() + lower.slice(1) ? lower : trimmed;
  }).filter(form => form !== word && !['more', 'most', 'less', 'least'].some(prefix => form === `${prefix} ${word}`)))];
  return entry;
}
type Observation = { model: string | null; provider: string | null; usage: Usage };
export interface BatchResult extends Observation { entries: Map<string, Generated>; invalid: string[]; raw: string | null }

export class DictionaryBatchGenerator {
  constructor(private config: BuildConfig, private key: string, private references?: Record<string, LexicalReference>,
    private fetcher: typeof fetch = fetch, private timeoutMs = 300_000) {
    if (!key.trim()) throw new Error('DICTIONARY_API_KEY is required');
    if (Boolean(config.referenceHash) !== Boolean(references)) throw new Error('Pinned references required');
  }
  async generate(words: string[], signal?: AbortSignal): Promise<BatchResult> {
    if (!words.length || words.length > 16 || new Set(words).size !== words.length) throw new GenerationError('INVALID_BATCH');
    if (this.config.referenceHash && words.some(word => !this.references?.[word])) throw new GenerationError('MISSING_REFERENCE');
    let observation: Observation = { model: null, provider: null, usage: { input: null, output: null } };
    let rawContent: string | undefined;
    const controller = new AbortController();
    let interrupt!: (error: GenerationError) => void;
    const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
    const abort = () => { controller.abort(); interrupt(new GenerationError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', true, observation)); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      return await Promise.race([(async () => {
        if (controller.signal.aborted) throw new GenerationError('CANCELLED', true, observation);
        const response = await this.fetcher(new URL('chat/completions', this.config.baseURL), {
          method: 'POST', signal: controller.signal, redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'X-Magpie-Session': 'rm-dictionary-batch-' + randomUUID() },
          body: JSON.stringify({ model: this.config.model, stream: false, max_tokens: words.length * this.config.maxOutputTokens,
            reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [
              { role: 'system', content: BATCH_PROMPT },
              { role: 'user', content: JSON.stringify({ items: words.map(word => ({ word, ...(this.references?.[word] ? { reference: this.references[word] } : {}) })) }) },
            ] }),
        });
        const route = responseRoute(response.headers);
        if (route) observation = { ...observation, model: route.selectedModel, provider: route.selectedProvider };
        if (!response.ok) {
          void response.body?.cancel();
          const retry = response.headers.get('retry-after');
          const until = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
          throw new GenerationError('HTTP_' + response.status, response.status === 429 || response.status >= 500, observation,
            response.status === 429 ? Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000 : undefined);
        }
        if (!response.body || !response.headers.get('content-type')?.includes('application/json')) { void response.body?.cancel(); throw new GenerationError('INVALID_CONTENT_TYPE', false, observation); }
        reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
        while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
          if (bytes > 512 * 1024) throw new GenerationError('OVERSIZED_RESPONSE', false, observation); chunks.push(next.value); }
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const tokens = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : null;
        observation.usage = { input: tokens(data.usage?.prompt_tokens), output: tokens(data.usage?.completion_tokens) };
        const choice = data.choices?.[0];
        if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls != null || choice.message?.function_call != null || typeof choice.message?.content !== 'string') throw new GenerationError('INVALID_COMPLETION', true, observation);
        const raw = choice.message.content as string;
        if (raw.includes(this.key)) throw new GenerationError('UNSAFE_PROVIDER_RESPONSE', false, observation);
        rawContent = raw.slice(0, 131072);
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new GenerationError('INVALID_JSON', true, observation); }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsed = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key === 'entries' || !emptyPlaceholder(value)));
        }
        const envelope = parsed as { entries?: unknown[] };
        if (!envelope || Object.keys(envelope).join(',') !== 'entries' || !Array.isArray(envelope.entries) || envelope.entries.length > words.length) throw new GenerationError('INVALID_BATCH', true, observation);
        const entries = new Map<string, Generated>(), seen = new Set<string>();
        for (const item of envelope.entries) {
          const candidate = item as { word?: unknown };
          let word = typeof candidate?.word === 'string' ? candidate.word : '';
          // Same title-case normalization as the single-word provider; no arbitrary acronym folding.
          if (!words.includes(word) && typeof candidate?.word === 'string') word = words.find(w => candidate.word === this.references?.[w]?.originalSpelling
            || w === 'i' && candidate.word === 'I' || w.length > 2 && candidate.word === w[0].toUpperCase() + w.slice(1)) ?? word;
          if (!words.includes(word) || seen.has(word)) throw new GenerationError('INVALID_BATCH', true, observation);
          seen.add(word);
          try { const entry = parseEntry(normalizeBatchEntry({ ...(item as object), word }, word, this.references?.[word]), word);
            entries.set(word, { entry, model: observation.model, provider: observation.provider, usage: { input: null, output: null } }); }
          catch { /* Individual invalid entries stay failed; valid siblings retain their original words. */ }
        }
        if (controller.signal.aborted) throw new GenerationError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', true, observation);
        const invalid = words.filter(word => !entries.has(word));
        return { ...observation, entries, invalid, raw: !raw.includes(this.key) ? raw.slice(0, 131072) : null };
      })(), interrupted]);
    } catch (error) {
      if (error instanceof GenerationError) throw rawContent
        ? new GenerationError(error.code, error.retryable, error.observation, error.retryAfter, rawContent) : error;
      throw new GenerationError(controller.signal.aborted ? signal?.aborted ? 'CANCELLED' : 'TIMEOUT' : 'NETWORK_ERROR', true, observation);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
}

/** Per-word reservations remain the original budget units, even though HTTP calls are shared. */
export async function runBatchBuild(store: DictionaryStore, build: string, generator: Pick<DictionaryBatchGenerator, 'generate'>,
  options: { limit?: number; batchSize?: number; delayMs?: number; routeId?: string; signal?: AbortSignal; drainSignal?: AbortSignal; emit?: (event: unknown) => void } = {}) {
  const limit = options.limit ?? 1000, size = options.batchSize ?? 8, pause = options.delayMs ?? 500;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000 || !Number.isInteger(size) || size < 1 || size > 16
    || !Number.isInteger(pause) || pause < 0 || pause > 60000) throw new Error('Invalid batch limits');
  const config = store.routeConfig(build, options.routeId); store.acquire();
  const controller = new AbortController(), abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
  let draining = false; const drain = () => { draining = true; };
  options.drainSignal?.addEventListener('abort', drain, { once: true }); if (options.drainSignal?.aborted) drain();
  let leaseError: unknown, completed = 0, networkRequests = 0, failures = 0, stopped = 'limit-or-exhausted';
  const heartbeat = setInterval(() => { try { store.heartbeat(); } catch (error) { leaseError = error; abort(); } }, 15000);
  try {
    options.emit?.({ event: 'dictionary_batch_start', build, batchSize: size, pid: process.pid, drainSupported: true });
    while (completed < limit && !controller.signal.aborted && !draining) {
      const jobs: { word: string; attempt: string }[] = [];
      for (let i = 0; i < Math.min(size, limit - completed); i++) { const job = store.reserve(build, options.routeId); if (!job) break; jobs.push(job); }
      if (!jobs.length) break;
      const id = randomUUID();
      store.transaction(() => { store.heartbeat();
        store.db.prepare('INSERT INTO generation_batches(id,build_id,prompt_hash,requested_model,max_output_tokens,started_at) VALUES(?,?,?,?,?,?)')
          .run(id, build, BATCH_PROMPT_HASH, config.model, jobs.length * config.maxOutputTokens, Date.now());
        for (const job of jobs) store.db.prepare('UPDATE attempts SET batch_id=? WHERE id=?').run(id, job.attempt);
      });
      let result: BatchResult | undefined, failure: GenerationError | undefined;
      try { result = await generator.generate(jobs.map(j => j.word), controller.signal); }
      catch (error) { failure = error instanceof GenerationError ? error : new GenerationError('GENERATOR_ERROR'); }
      if (leaseError) throw leaseError;
      const observation = result ?? failure?.observation;
      store.transaction(() => { store.heartbeat(); store.db.prepare('UPDATE generation_batches SET finished_at=?,input_tokens=?,output_tokens=?,actual_model=?,provider=?,error=?,raw_content=? WHERE id=?')
        .run(Date.now(), observation?.usage.input ?? null, observation?.usage.output ?? null, observation?.model ?? null, observation?.provider ?? null,
          failure?.code ?? (result?.invalid.length ? 'PARTIAL_BATCH' : null), result?.raw ?? failure?.rawContent ?? null, id); });
      for (const job of jobs) {
        const entry = result?.entries.get(job.word);
        // Network usage belongs to the batch, never duplicated across individual word attempts.
        const error = entry ? undefined : new GenerationError(failure?.code ?? 'INVALID_ENTRY', failure?.retryable ?? true,
          { model: observation?.model ?? null, provider: observation?.provider ?? null, usage: { input: null, output: null } }, failure?.retryAfter);
        store.complete(build, job, entry, error); completed++;
      }
      networkRequests++; failures = result?.entries.size ? 0 : failures + 1;
      options.emit?.({ event: 'dictionary_batch', batch: id, words: jobs.map(j => j.word), drafts: result?.entries.size ?? 0,
        error: failure?.code ?? (result?.invalid.length ? 'PARTIAL_BATCH' : null), completed, networkRequests });
      if (failure?.code === 'HTTP_429') { store.cooldown(failure.retryAfter ?? Date.now() + 60000); stopped = 'provider-cooldown'; break; }
      if (failure && !failure.retryable || failures >= 3) { stopped = 'provider-failures'; break; }
      if (!controller.signal.aborted) await delay(pause, undefined, { signal: controller.signal }).catch(() => {});
    }
    return { completed, networkRequests, stopped: controller.signal.aborted ? 'cancelled' : draining ? 'drained' : stopped, ...store.status(build) };
  } finally { clearInterval(heartbeat); options.signal?.removeEventListener('abort', abort); options.drainSignal?.removeEventListener('abort', drain); store.release(); }
}
