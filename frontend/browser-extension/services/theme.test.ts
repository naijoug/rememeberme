import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTheme, saveTheme, watchTheme } from './theme';

const api = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), watch: vi.fn() }));
vi.mock('wxt/utils/storage', () => ({ storage: api }));
let systemDark = false;
let media: EventTarget & { matches: boolean };
beforeEach(() => {
  vi.resetAllMocks();
  systemDark = false;
  media = Object.assign(new EventTarget(), { get matches() { return systemDark; } });
  Object.defineProperty(media, 'matches', { get: () => systemDark });
  vi.stubGlobal('matchMedia', () => media);
  api.getItem.mockResolvedValue('system');
  api.watch.mockReturnValue(vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('shared appearance preference', () => {
  it('defaults to the system and reacts when the system theme changes', async () => {
    const update = vi.fn();
    const stop = watchTheme(update);
    await Promise.resolve();
    expect(update).toHaveBeenLastCalledWith({ preference: 'system', resolved: 'light' });
    systemDark = true;
    media.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith({ preference: 'system', resolved: 'dark' });
    stop();
    media.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('shares explicit changes with open surfaces and ignores stale initial reads', async () => {
    let finish!: (value: string) => void;
    api.getItem.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const update = vi.fn();
    const stop = watchTheme(update);
    api.watch.mock.calls[0][1]('dark');
    finish('light');
    await Promise.resolve();
    expect(update).toHaveBeenLastCalledWith({ preference: 'dark', resolved: 'dark' });
    media.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith({ preference: 'dark', resolved: 'dark' });
    stop();
  });

  it('stores appearance separately from vocabulary and normalizes invalid preferences', async () => {
    await saveTheme('dark');
    expect(api.setItem).toHaveBeenCalledExactlyOnceWith('local:appearance', 'dark');
    expect(normalizeTheme('unknown')).toBe('system');
  });

  it('can dispose a page UI after its extension context has already gone away', () => {
    api.watch.mockReturnValue(() => { throw new Error('Extension context invalidated'); });
    const update = vi.fn();
    const stop = watchTheme(update);
    expect(() => stop()).not.toThrow();
    media.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledTimes(1);
  });
});
