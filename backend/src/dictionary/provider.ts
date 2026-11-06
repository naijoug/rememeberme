import { randomUUID } from 'node:crypto';
import { responseRoute } from '../magpie-observation';
import { PROMPT, GenerationError, parseEntry, type BuildConfig, type Generated } from './model';

export class DictionaryGenerator {
  constructor(private config: BuildConfig, private key: string, private fetcher: typeof fetch = fetch,
    private timeoutMs = 60_000) {
    if (!key.trim()) throw new Error('DICTIONARY_API_KEY is required');
  }
  async generate(word: string, signal?: AbortSignal): Promise<Generated> {
    const controller = new AbortController();
    let observation: Omit<Generated, 'entry'> = { model: null, provider: null, usage: { input: null, output: null } };
    let interrupt!: (error: GenerationError) => void;
    const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
    const abort = () => {
      controller.abort();
      interrupt(new GenerationError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', true, observation));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, this.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      return await Promise.race([(async (): Promise<Generated> => {
        if (controller.signal.aborted) throw new GenerationError('CANCELLED', true, observation);
        const response = await this.fetcher(new URL('chat/completions', this.config.baseURL), {
          method: 'POST', signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json',
            'X-Magpie-Session': 'rm-dictionary-' + randomUUID(), 'User-Agent': 'RememberMe/dictionary-build' },
          body: JSON.stringify({ model: this.config.model, stream: false, max_tokens: this.config.maxOutputTokens, reasoning_effort: 'low',
            messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify({ word }) }] }),
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new GenerationError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', true, observation);
        }
        const route = responseRoute(response.headers);
        if (route) observation = { ...observation, model: route.selectedModel, provider: route.selectedProvider };
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new GenerationError(`HTTP_${response.status}`, response.status === 429 || response.status >= 500, observation);
        }
        if (!response.body || !response.headers.get('content-type')?.includes('application/json')) {
          void response.body?.cancel().catch(() => {}); throw new GenerationError('INVALID_CONTENT_TYPE', false, observation);
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.length;
          if (size > 128 * 1024) throw new GenerationError('OVERSIZED_RESPONSE', false, observation);
          chunks.push(next.value);
        }
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const tokens = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0 ? n as number : null;
        observation.usage = { input: tokens(data?.usage?.prompt_tokens), output: tokens(data?.usage?.completion_tokens) };
        const choice = data?.choices?.[0];
        if (!choice || choice.finish_reason !== 'stop' || choice.message?.tool_calls != null || choice.message?.function_call != null
          || typeof choice.message?.content !== 'string') throw new GenerationError('INVALID_COMPLETION', true, observation);
        let entry;
        try { entry = parseEntry(JSON.parse(choice.message.content), word); }
        catch { throw new GenerationError('INVALID_ENTRY', true, observation); }
        if (controller.signal.aborted) throw new GenerationError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', true, observation);
        return { entry, ...observation };
      })(), interrupted]);
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(controller.signal.aborted ? signal?.aborted ? 'CANCELLED' : 'TIMEOUT'
        : error instanceof SyntaxError ? 'INVALID_JSON' : 'NETWORK_ERROR', true, observation);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
}
