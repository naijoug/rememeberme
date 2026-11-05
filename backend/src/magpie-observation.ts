import { object } from '../../contracts/api-v1';

export interface MagpieWordObservation {
  event: 'word_translation'; callId: string; requestedModel: string;
  selectedModel?: string; selectedProvider?: string;
  routeSource: 'response-header' | 'route-trace' | 'unknown';
  durationMs: number; headersMs?: number; upstreamStatus?: number;
  outcome: 'success' | 'failure'; errorCode?: string;
}
// Route metadata is untrusted. Never log account labels, arbitrary error text,
// tokens, prompts, selected words or upstream response bodies.
export function modelId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 192 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(value) ? value : undefined;
}
export function selectedRoute(value: unknown): { selectedModel: string; selectedProvider: string } | undefined {
  const model = modelId(value);
  if (!model || model.startsWith('group/') || model.startsWith('auto/')) return;
  return { selectedModel: model, selectedProvider: model.slice(0, model.indexOf('/')) };
}
export function responseRoute(headers: Headers) {
  const route = selectedRoute(headers.get('X-Magpie-Model'));
  return route && route.selectedProvider === headers.get('X-Magpie-Provider') ? route : undefined;
}

/** A best-effort trace read for failures without headers; never delays the lookup. */
export async function failedRoute(base: URL, key: string, callId: string, fetcher: typeof fetch) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const url = new URL('magpie/route', base); url.searchParams.set('session', callId);
      const response = await fetcher(url, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (controller.signal.aborted || !response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) {
        void response.body?.cancel().catch(() => {}); return;
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength; if (size > 16 * 1024) return;
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (controller.signal.aborted || !object(data) || data.session !== callId || !object(data.route)) return;
      return selectedRoute(data.route.model);
    })(), new Promise<undefined>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(undefined); }, 250); })]);
  } catch { return; }
  finally {
    clearTimeout(timer); controller.abort();
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

export function observeWord(base: URL, key: string, fetcher: typeof fetch, value: MagpieWordObservation,
  observe?: (value: MagpieWordObservation) => void): void {
  if (!observe) return;
  const deliver = (entry: MagpieWordObservation) => { try { observe(entry); } catch { /* Diagnostics cannot fail translation. */ } };
  if (value.selectedModel || value.outcome === 'success') { deliver(value); return; }
  void failedRoute(base, key, value.callId, fetcher).then(route => deliver(route
    ? { ...value, ...route, routeSource: 'route-trace' } : value));
}
