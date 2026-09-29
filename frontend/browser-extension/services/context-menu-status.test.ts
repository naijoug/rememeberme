import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextMenuStatus } from './context-menu-status';

afterEach(() => vi.unstubAllGlobals());

describe('context-menu toolbar fallback', () => {
  it.each(['action', 'browserAction'])('shows the real error without a content script via %s', async key => {
    const action = { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() };
    vi.stubGlobal('browser', { [key]: action });
    await contextMenuStatus.show(7, 'Refresh the webpage and try again.', 'error');
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
    expect(action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Remember Me: Refresh the webpage and try again.' });
  });

  it('clears the old status before another action', async () => {
    const action = { setBadgeText: vi.fn(), setTitle: vi.fn() };
    vi.stubGlobal('browser', { action, runtime: { getManifest: () => ({ name: 'Remember Me · Local' }) } });
    await contextMenuStatus.clear(7);
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
    expect(action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Remember Me · Local' });
  });
});
