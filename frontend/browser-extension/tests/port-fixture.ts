/** Mock transport only: route a port start to an existing disposable message responder. */
export function fixtureConnect(send: (message: any) => Promise<any>, started?: (message: any, emit: (reply: any) => void) => void) {
  return () => {
    const messages = new Set<(message: any) => void>(), disconnects = new Set<() => void>();
    let closed = false;
    const port = {
      name: 'rememberme-lookup-v1',
      onMessage: { addListener: (fn: (message: any) => void) => messages.add(fn), removeListener: (fn: (message: any) => void) => messages.delete(fn) },
      onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
      disconnect() { if (closed) return; closed = true; for (const fn of disconnects) fn(); },
      postMessage(message: any) {
        if (message.type === 'cancel') { port.disconnect(); return; }
        if (message.type !== 'start') return;
        started?.(message, reply => {
          if (!closed) for (const fn of messages) fn({ requestId: message.requestId, sessionId: message.sessionId, ...reply });
        });
        void send({ type: message.operation, ...message.payload }).then(reply => {
          if (closed) return;
          for (const fn of messages) fn({ type: reply?.success ? 'result' : 'error', requestId: message.requestId, sessionId: message.sessionId,
            data: reply?.data, error: reply?.error || 'The extension is reconnecting. Please try again.' });
        });
      },
    };
    return port;
  };
}
