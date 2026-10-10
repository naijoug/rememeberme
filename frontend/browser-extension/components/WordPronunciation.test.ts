import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { IconoirProvider } from '@iconoir/vue';
import WordPronunciation from './WordPronunciation.vue';
import type { Definition } from '~/types';
const { requestPhonetics } = vi.hoisted(() => ({ requestPhonetics: vi.fn() }));
vi.mock('~/services/lookup-client', () => ({ requestPhonetics }));

let app: App | undefined;
let host: HTMLElement;
let voices: SpeechSynthesisVoice[];
let spoken: SpeechSynthesisUtterance[];
let synth: EventTarget & { getVoices: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
const voice = (lang: string, localService = true) => ({ lang, localService, name: lang }) as SpeechSynthesisVoice;

beforeEach(() => {
  requestPhonetics.mockReset().mockResolvedValue({});
  voices = [voice('en-US'), voice('en-GB')];
  spoken = [];
  synth = Object.assign(new EventTarget(), {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => spoken.push(utterance)),
    cancel: vi.fn(),
  });
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    constructor(public text: string) {}
    lang = ''; voice = null; rate = 1; onend = null; onerror = null;
  });
});
afterEach(() => {
  app?.unmount(); app = undefined; host?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function mount(word = 'consumption', definition?: Definition) {
  const props = reactive({ word, definition });
  host = document.createElement('div'); document.body.appendChild(host);
  app = createApp({ render: () => h(IconoirProvider, {}, { default: () => h(WordPronunciation, props) }) });
  app.mount(host); await nextTick();
  return props;
}
function button(accent: string) {
  return host.querySelector<HTMLButtonElement>(`[data-accent="${accent}"]`)!;
}

describe('word pronunciation', () => {
  it('shows sourced US/UK IPA next to icon-only playback controls for a local word', async () => {
    requestPhonetics.mockResolvedValue({ us: '/ˈtɹɪk/', uk: '/tɹˈɪk/' });
    await mount('trick', { word: 'trick', source: 'wordnet', phonetics: [], meanings: [] });
    expect([...host.querySelectorAll('.phonetic')].map(item => item.textContent)).toEqual(['/ˈtɹɪk/', '/tɹˈɪk/']);
    expect(button('US').textContent?.trim()).toBe('');
    expect(button('UK').textContent?.trim()).toBe('');
    expect(button('US').parentElement?.querySelector('.phonetic')?.textContent).toBe('/ˈtɹɪk/');
    expect(requestPhonetics).toHaveBeenCalledWith('trick', expect.any(AbortSignal));
  });

  it('ignores stale phonetics after a new word, keeps playback available on failure and retries', async () => {
    let resolveFirst!: (value: unknown) => void;
    requestPhonetics.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; })).mockRejectedValueOnce(new Error('Unavailable'));
    const props = await mount('trick');
    const oldSignal = requestPhonetics.mock.calls[0]![1] as AbortSignal;
    props.word = 'apple'; await nextTick(); await nextTick();
    resolveFirst({ us: '/stale/' }); await nextTick();
    expect(oldSignal.aborted).toBe(true);
    expect(host.textContent).not.toContain('/stale/');
    expect(host.textContent).toContain('Phonetics unavailable');
    expect(button('US').disabled).toBe(false);
    requestPhonetics.mockResolvedValueOnce({ us: '/ˈæpəl/' });
    host.querySelector<HTMLButtonElement>('.rm-text-action')!.click(); await nextTick(); await nextTick();
    expect(host.textContent).toContain('/ˈæpəl/');
    expect(host.textContent).not.toContain('Phonetics unavailable');
  });

  it('plays the selected word with distinct US/UK voices even without dictionary phonetics', async () => {
    await mount('Having');
    expect(synth.speak).not.toHaveBeenCalled();
    button('US').click(); await nextTick();
    expect(spoken[0]!.text).toBe('Having');
    expect(spoken[0]!.lang).toBe('en-US');
    expect(spoken[0]!.voice).toBe(voices[0]);
    expect(button('US').getAttribute('aria-pressed')).toBe('true');
    const lateEnd = spoken[0]!.onend;
    button('UK').click(); await nextTick();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(spoken[1]!.voice).toBe(voices[1]);
    expect(spoken[1]!.lang).toBe('en-GB');
    lateEnd?.call(spoken[0]!, {} as SpeechSynthesisEvent);
    expect(button('UK').getAttribute('aria-pressed')).toBe('true');
    spoken[1]!.onend?.call(spoken[1]!, {} as SpeechSynthesisEvent); await nextTick();
    expect(button('UK').getAttribute('aria-pressed')).toBe('false');
  });

  it('stops on repeat click, word change and unmount, without cancelling unrelated speech on idle teardown', async () => {
    const props = await mount();
    button('US').click(); await nextTick();
    button('US').click(); await nextTick();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(button('US').getAttribute('aria-pressed')).toBe('false');
    button('US').click();
    props.word = 'apple'; await nextTick();
    expect(button('US').getAttribute('aria-pressed')).toBe('false');
    button('UK').click();
    app!.unmount(); app = undefined;
    expect(synth.cancel).toHaveBeenCalledTimes(3);
    await mount();
    app!.unmount(); app = undefined;
    expect(synth.cancel).toHaveBeenCalledTimes(3);
  });

  it('prefers local exact-accent voices and updates when voices load asynchronously', async () => {
    voices = [];
    await mount();
    expect(button('US').disabled).toBe(true);
    voices = [voice('en-US', false), voice('en_US'), voice('en-AU')];
    synth.dispatchEvent(new Event('voiceschanged')); await nextTick();
    expect(button('US').disabled).toBe(false);
    expect(button('UK').disabled).toBe(true);
    expect(host.textContent).toContain('British voice unavailable');
    button('US').click();
    expect(spoken[0]!.voice).toBe(voices[1]);
  });

  it('keeps playback errors retryable and bounds a stalled speech engine', async () => {
    vi.useFakeTimers();
    await mount();
    button('US').click();
    spoken[0]!.onerror?.call(spoken[0]!, {} as SpeechSynthesisErrorEvent); await nextTick();
    expect(host.textContent).toContain('Could not play pronunciation');
    button('US').click(); await nextTick();
    expect(host.textContent).not.toContain('Could not play pronunciation');
    await vi.advanceTimersByTimeAsync(8000);
    expect(host.textContent).toContain('Pronunciation timed out');
    expect(button('US').disabled).toBe(false);
    expect(button('US').getAttribute('aria-pressed')).toBe('false');
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('handles unsupported browsers and invalid legacy words without trying to speak', async () => {
    await mount('two words');
    expect(button('US').disabled).toBe(true);
    expect(host.textContent).toContain('single English words');
    app!.unmount(); app = undefined; host.remove();
    vi.stubGlobal('speechSynthesis', undefined);
    await mount();
    expect(button('UK').disabled).toBe(true);
    expect(host.textContent).toContain('unavailable in this browser');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('renders phonetics literally and tolerates malformed imported optional fields', async () => {
    const props = await mount('apple', { word: 'apple', phonetics: [{ text: '<img src=x onerror=alert(1)>' }], meanings: [] });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.phonetic')?.textContent).toBe('<img src=x onerror=alert(1)>');
    props.definition = { word: 'apple', phonetic: {} as string, phonetics: [null, { text: 123 }] as any, meanings: [] };
    await nextTick();
    expect(host.querySelector('.phonetic')).toBeNull();
  });
});
