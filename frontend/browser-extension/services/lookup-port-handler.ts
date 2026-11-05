import { isEnglishWord } from './word-utils';
import { LOOKUP_PORT, type LookupOperation } from './lookup-port-client';
import { lookupCancelled } from './shared-lookup';

interface Event<T extends (...args: any[]) => void> { addListener(callback: T): void; removeListener(callback: T): void }
export interface LookupPort {
  name: string;
  sender?: { url?: string; tab?: { id?: number }; frameId?: number };
  onMessage: Event<(message: any) => void>; onDisconnect: Event<() => void>;
  postMessage(message: unknown): void; disconnect(): void;
}
export interface PortDependencies {
  authorize(operation: LookupOperation): Promise<void>;
  run(operation: LookupOperation, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  subscribePolicy(recheck: () => void): () => void;
}
const operations = new Set<LookupOperation>(['GET_DEFINITION', 'GET_TRANSLATION', 'GET_PHONETICS', 'EXPLAIN_CONTEXT', 'EXPLANATION_CAPABILITIES']);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
/** A port owns exactly one subscription. Sender metadata never comes from its message. */
export function handleLookupPort(port: LookupPort, deps: PortDependencies): void {
  if (port.name !== LOOKUP_PORT) return;
  const controller = new AbortController();
  let started = false, closed = false;
  let requestId = '', sessionId = '', operation: LookupOperation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); controller.abort(lookupCancelled());
    port.onMessage.removeListener(message); port.onDisconnect.removeListener(finish); stopPolicy();
    try { port.disconnect(); } catch { /* Already disconnected. */ }
  };
  const reply = (type: 'result' | 'error', value: unknown) => {
    if (closed) return;
    try { port.postMessage({ type, requestId, sessionId, ...(type === 'result' ? { data: value } : { error: value }) }); } catch { /* Client disappeared. */ }
    finish();
  };
  const recheck = () => {
    if (started && !closed) void deps.authorize(operation).catch(() => reply('error', 'Lookup stopped because its settings changed.'));
  };
  const stopPolicy = deps.subscribePolicy(recheck);
  const message = (value: any) => {
    if (closed) return;
    if (value?.type === 'cancel') {
      if (value.requestId === requestId && value.sessionId === sessionId || !started) finish();
      return;
    }
    if (started || value?.type !== 'start' || !id(value.requestId) || !id(value.sessionId) || !operations.has(value.operation)
      || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) { finish(); return; }
    started = true; requestId = value.requestId; sessionId = value.sessionId; operation = value.operation;
    if (operation.startsWith('GET_') && (typeof value.payload.word !== 'string' || value.payload.word.length > 500 || !isEnglishWord(value.payload.word))) { reply('error', 'Select one English word.'); return; }
    void (async () => {
      await deps.authorize(operation); controller.signal.throwIfAborted();
      const result = await deps.run(operation, value.payload, controller.signal);
      controller.signal.throwIfAborted(); reply('result', result);
    })().catch(error => { if (!closed) reply('error', error instanceof Error ? error.message : 'Lookup unavailable.'); });
  };
  port.onMessage.addListener(message); port.onDisconnect.addListener(finish);
  // Includes pre-start and authorization waits, so an abandoned port cannot leak state.
  timer = setTimeout(() => reply('error', 'Lookup timed out. Please try again.'), 22_000);
}
