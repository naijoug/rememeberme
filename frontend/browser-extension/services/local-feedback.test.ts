import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconnectLocalPage, refreshLocalContent, startLocalFeedback } from './local-feedback';
import { LOCAL_FEEDBACK_AVAILABLE, LOCAL_FEEDBACK_READY } from '~/config/local-feedback';

const payload = { contentScript: { matches: ['<all_urls>'], js: ['content-scripts/content.js'], css: ['content-scripts/content.css'] } };
const api = {
  runtime: { reload: vi.fn() },
  tabs: { query: vi.fn(), reload: vi.fn() },
  scripting: { getRegisteredContentScripts: vi.fn(), registerContentScripts: vi.fn(), updateContentScripts: vi.fn(), removeCSS: vi.fn(), insertCSS: vi.fn(), executeScript: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('browser', api);
  api.scripting.getRegisteredContentScripts.mockResolvedValue([]);
  api.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local feedback updates', () => {
  it('reconnects only the clicked frame without reloading the page', async () => {
    await reconnectLocalPage(7, 3);
    expect(api.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 7, frameIds: [3] }, files: ['/content-scripts/content.js'] });
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });
  it('registers the current scripts and replaces them on open pages without reloading pages', async () => {
    await refreshLocalContent(payload);
    expect(api.scripting.registerContentScripts).toHaveBeenCalledWith([{ ...payload.contentScript, id: 'wxt:content-scripts/content.js' }]);
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1, allFrames: false }, files: ['/content-scripts/content.js'] });
    expect(api.scripting.removeCSS).toHaveBeenCalledTimes(2);
    expect(api.scripting.insertCSS).toHaveBeenCalledTimes(2);
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });

  it('updates existing registration and continues when one tab cannot be injected', async () => {
    api.scripting.getRegisteredContentScripts.mockResolvedValue([{ id: 'wxt:content-scripts/content.js' }]);
    api.scripting.executeScript.mockRejectedValueOnce(new Error('Restricted page'));
    await refreshLocalContent(payload);
    expect(api.scripting.updateContentScripts).toHaveBeenCalledTimes(1);
    expect(api.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(api.tabs.reload).not.toHaveBeenCalled();
  });

  it.each([true, false])('recovers after disconnection (previous connection: %s) and cancels retries on stop', async initiallyConnected => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      send = vi.fn();
      constructor() { super(); sockets.push(this); }
      close() { this.dispatchEvent(new Event('close')); }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    const stop = startLocalFeedback();
    if (initiallyConnected) {
      sockets[0].dispatchEvent(new Event('open'));
      expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toEqual({ type: 'custom', event: LOCAL_FEEDBACK_READY });
    }
    sockets[0].close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(2);
    sockets[1].dispatchEvent(new Event('open'));
    expect(api.runtime.reload).not.toHaveBeenCalled();
    sockets[1].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'custom', event: LOCAL_FEEDBACK_AVAILABLE }) }));
    expect(api.runtime.reload).toHaveBeenCalledTimes(1);
    sockets[1].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'custom', event: LOCAL_FEEDBACK_AVAILABLE }) }));
    expect(api.runtime.reload).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(sockets).toHaveLength(2);
  });
});
