import { MagpieCapacity } from './magpie-capacity';
import { TranslationCircuit } from './translation-circuit';
import { WORD_PRIMARY_TIMEOUT_MS } from '../../contracts/translation-policy';
import { ApiError, object } from '../../contracts/api-v1';
import type { Translation } from './runtime';
import { modelId, observeWord, responseRoute, type MagpieWordObservation } from './magpie-observation';

export const WORD_TRANSLATION_PROMPT = 'Translate the single English word into concise Simplified Chinese dictionary meanings. Return only JSON {"text":"..."} with no Markdown. Do not use tools, memory, or personal context.';
/** Word-only inference. Opaque per-call tracing IDs never carry a conversation or word. */
export class MagpieTranslator {
  private readonly base: URL;
  private capacity: MagpieCapacity;
  private circuit = new TranslationCircuit();
  constructor(private readonly options: {
    baseURL: string; key: string; model: string; timeoutMs?: number; maxConcurrent?: number;
    fetch?: typeof fetch; capacity?: MagpieCapacity;
    observe?: (value: MagpieWordObservation) => void;
  }) {
    this.capacity = options.capacity ?? new MagpieCapacity(options.maxConcurrent ?? 2);
    this.base = new URL(options.baseURL.replace(/\/?$/, '/'));
    if (this.base.username || this.base.password || this.base.search || this.base.hash
      || !(this.base.protocol === 'https:' || (this.base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname)))
      || !options.key.trim() || !options.model.trim()) throw new Error('Invalid private Magpie configuration');
  }
  async translate(word: string): Promise<Translation> {
    if (word.length > 500 || !/^[a-z](?:[a-z'-]*[a-z])?$/.test(word)) throw new ApiError('INVALID_LOOKUP_WORD');
    const release = this.capacity.acquire('word');
    if (!release) throw new ApiError('TRANSLATION_BUSY', 503, true);
    const complete = this.circuit.enter();
    if (!complete) { release(); throw new ApiError('TRANSLATION_CIRCUIT_OPEN', 503, true); }
    const started = performance.now();
    const observation: MagpieWordObservation = { event: 'word_translation', callId: 'rm-word-' + crypto.randomUUID(),
      requestedModel: modelId(this.options.model) ?? 'unrecognized', routeSource: 'unknown', durationMs: 0, outcome: 'failure' };
    const fetcher = this.options.fetch ?? fetch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError('TRANSLATION_TIMEOUT', 504, true));
        controller.abort();
        void reader?.cancel().catch(() => {});
      }, this.options.timeoutMs ?? WORD_PRIMARY_TIMEOUT_MS);
    });
    try {
      const translation = await Promise.race([(async (): Promise<Translation> => {
        const response = await fetcher(new URL('chat/completions', this.base), {
          method: 'POST', signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Authorization: 'Bearer ' + this.options.key, Accept: 'application/json',
            'Content-Type': 'application/json', 'User-Agent': 'RememberMe/translation', 'X-Magpie-Session': observation.callId },
          // Leave room for both reasoning and final JSON without long deliberation.
          body: JSON.stringify({ model: this.options.model, stream: false, max_tokens: 512, reasoning_effort: 'low',
            messages: [
              { role: 'system', content: WORD_TRANSLATION_PROMPT },
              { role: 'user', content: word },
            ] }),
        });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new ApiError('TRANSLATION_TIMEOUT', 504, true); }
        observation.headersMs = Math.round(performance.now() - started); observation.upstreamStatus = response.status;
        const route = responseRoute(response.headers);
        if (route) Object.assign(observation, route, { routeSource: 'response-header' });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new ApiError(response.status === 429 ? 'TRANSLATION_BUSY' : 'TRANSLATION_UNAVAILABLE', 503, true);
        }
        if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
          void response.body?.cancel().catch(() => {});
          throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let length = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            length += next.value.length;
            if (length > 64 * 1024) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
            chunks.push(next.value);
          }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          const choice = object(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
          if (!object(choice) || choice.finish_reason !== 'stop' || !object(choice.message)
            || choice.message.tool_calls != null || choice.message.function_call != null
            || typeof choice.message.content !== 'string') throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
          const result: unknown = JSON.parse(choice.message.content);
          if (!object(result) || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 2000
            || result.text.trim().toLowerCase() === word || !/[\u3400-\u9fff]/u.test(result.text)) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
          if (controller.signal.aborted) throw new ApiError('TRANSLATION_TIMEOUT', 504, true);
          return { text: result.text.trim(), target: 'zh-CN', source: 'magpie' };
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      })(), deadline]);
      complete(true);
      observation.outcome = 'success';
      return translation;
    } catch (error) {
      complete(false);
      observation.errorCode = error instanceof ApiError ? error.code
        : error instanceof SyntaxError || error instanceof TypeError && reader ? 'TRANSLATION_INVALID_RESPONSE' : 'TRANSLATION_UNAVAILABLE';
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError || error instanceof TypeError && reader) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
      throw new ApiError('TRANSLATION_UNAVAILABLE', 503, true);
    } finally {
      clearTimeout(timer); release(); observation.durationMs = Math.round(performance.now() - started);
      observeWord(this.base, this.options.key, fetcher, { ...observation }, this.options.observe);
    }
  }
}
