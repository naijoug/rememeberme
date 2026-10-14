import { ApiError, object } from '../../contracts/api-v1';
import type { Translation } from './runtime';

export class HermesTranslator {
  private pending = new Map<string, Promise<Translation>>();
  private cache = new Map<string, { value: Translation; expires: number }>();
  private verifiedUntil = 0;
  private verifying?: Promise<void>;
  private active = 0;
  private readonly base: URL;
  constructor(private readonly options: {
    baseURL: string; key: string; model: string; timeoutMs?: number; maxConcurrent?: number;
    fetch?: typeof fetch;
  }) {
    this.base = new URL(options.baseURL.replace(/\/?$/, '/'));
    if (this.base.username || this.base.password || this.base.search || this.base.hash
      || !(this.base.protocol === 'https:' || (this.base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname)))
      || !options.key || !options.model) throw new Error('Invalid private Hermes configuration');
  }
  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await (this.options.fetch ?? fetch)(new URL(path, this.base), {
      method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
      headers: { Authorization: 'Bearer ' + this.options.key, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(response.status === 429 ? 'TRANSLATION_BUSY' : 'TRANSLATION_UNAVAILABLE', 503, true);
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length;
        if (length > 64 * 1024) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async verify(signal: AbortSignal): Promise<void> {
    if (Date.now() < this.verifiedUntil) return;
    if (!this.verifying) {
      this.verifying = (async () => {
        const discovery = await this.json('toolsets', signal);
        const tools = Array.isArray(discovery) ? discovery
          : object(discovery) && discovery.object === 'list' && discovery.platform === 'api_server'
            && Array.isArray(discovery.data) ? discovery.data : undefined;
        if (!tools || tools.some(tool => !object(tool) || !Array.isArray(tool.tools)
          || tool.enabled !== false)) {
          throw new ApiError('TRANSLATION_PROFILE_NOT_ISOLATED', 503);
        }
        this.verifiedUntil = Date.now() + 60_000;
      })().finally(() => { this.verifying = undefined; });
    }
    await this.verifying;
  }
  async translate(word: string): Promise<Translation> {
    const cached = this.cache.get(word);
    if (cached && cached.expires > Date.now()) return cached.value;
    const existing = this.pending.get(word); if (existing) return existing;
    if (this.active >= (this.options.maxConcurrent ?? 2)) throw new ApiError('TRANSLATION_BUSY', 503, true);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ApiError('TRANSLATION_TIMEOUT', 504, true)); }, this.options.timeoutMs ?? 12_000);
    });
    this.active++;
    const request = Promise.race([this.perform(word, controller.signal), deadline]).catch(error => {
      if (error instanceof ApiError) throw error;
      throw new ApiError('TRANSLATION_UNAVAILABLE', 503, true);
    }).finally(() => { clearTimeout(timer); this.active--; this.pending.delete(word); });
    this.pending.set(word, request);
    return request;
  }
  private async perform(word: string, signal: AbortSignal): Promise<Translation> {
    await this.verify(signal);
    const data = await this.json('chat/completions', signal, {
      model: this.options.model, stream: false,
      messages: [
        { role: 'system', content: 'Translate the single English word into concise Simplified Chinese dictionary meanings. Return only JSON {"text":"..."} with no Markdown. Do not use tools, memory, or personal context.' },
        { role: 'user', content: word },
      ],
    });
    if (!object(data) || !Array.isArray(data.choices) || !object(data.choices[0]) || !object(data.choices[0].message)
      || typeof data.choices[0].message.content !== 'string') throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
    let result: unknown;
    try { result = JSON.parse(data.choices[0].message.content); } catch { throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502); }
    if (!object(result) || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 2000
      || result.text.trim().toLowerCase() === word || !/[\u3400-\u9fff]/u.test(result.text)) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
    const value: Translation = { text: result.text.trim(), target: 'zh-CN', source: 'hermes' };
    if (signal.aborted) throw new ApiError('TRANSLATION_TIMEOUT', 504, true);
    this.cache.delete(word); this.cache.set(word, { value, expires: Date.now() + 7 * 86_400_000 });
    while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
