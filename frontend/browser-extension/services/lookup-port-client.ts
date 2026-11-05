import { lookupCancelled } from './shared-lookup';
export const LOOKUP_PORT = 'rememberme-lookup-v1';
export type LookupOperation = 'GET_DEFINITION' | 'GET_TRANSLATION' | 'GET_PHONETICS' | 'EXPLAIN_CONTEXT' | 'EXPLANATION_CAPABILITIES';
export function portLookup<T>(operation: LookupOperation, payload: object, timeout: number, signal?: AbortSignal, onCached?: (data: T) => void): Promise<T> {
  if (signal?.aborted) return Promise.reject(lookupCancelled());
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID(), sessionId = crypto.randomUUID();
    const port = browser.runtime.connect({ name: LOOKUP_PORT });
    let settled = false;
    const finish = (error?: Error, data?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect);
      try { port.disconnect(); } catch { /* Context already closed. */ }
      if (error) reject(error); else resolve(data!);
    };
    const cancel = () => {
      try { port.postMessage({ type: 'cancel', requestId, sessionId }); } catch { /* Disconnected. */ }
      finish(lookupCancelled());
    };
    const onDisconnect = () => finish(new Error('The extension is reconnecting. Please try again.'));
    const onMessage = (message: { type?: string; requestId?: string; sessionId?: string; error?: string; data?: T }) => {
      if (message?.requestId !== requestId || message.sessionId !== sessionId) return;
      if (message.type === 'cached' && operation === 'GET_TRANSLATION' && message.data !== undefined) {
        try { onCached?.(message.data); } catch { cancel(); }
      } else if (message.type === 'result') finish(undefined, message.data);
      else if (message.type === 'error') finish(new Error(message.error || 'Lookup unavailable. Please try again.'));
    };
    const timer = setTimeout(() => finish(new Error(operation === 'GET_TRANSLATION' ? 'Chinese translation timed out. Please try again.' : operation === 'GET_DEFINITION' ? 'The dictionary is taking too long. Please try again.' : 'Lookup timed out. Please try again.')), timeout);
    port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    try { port.postMessage({ type: 'start', requestId, sessionId, operation, payload }); } catch { onDisconnect(); }
  });
}
