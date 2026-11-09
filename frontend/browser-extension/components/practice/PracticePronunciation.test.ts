import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import PracticePronunciation from './PracticePronunciation.vue';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('~/services/phonetics', () => ({ PhoneticsService: class { getPhonetics = get; } }));
let app: App, root: HTMLElement;
let synth: EventTarget & { getVoices: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
beforeEach(() => {
  get.mockReset().mockResolvedValue({ us: '/ˈkænsəl/' });
  synth = Object.assign(new EventTarget(), { getVoices: vi.fn(() => [{ lang: 'en-US', localService: true }]), speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} lang = ''; voice = null; rate = 1; onstart = null; onend = null; onerror = null; });
  root = document.createElement('div'); document.body.append(root);
});
afterEach(() => { app?.unmount(); root.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(active = false, obscured = false) { const props = reactive({ word: 'cancel', active, obscured }); app = createApp({ render: () => h(PracticePronunciation, props) }); app.mount(root); await nextTick(); await nextTick(); return props; }
it('shows packaged IPA and speaks the current word with a device US voice', async () => {
  const props = await mount(); expect(root.textContent).toContain('/ˈkænsəl/'); expect(synth.speak).not.toHaveBeenCalled();
  root.querySelector('button')!.click(); expect(synth.speak.mock.calls[0][0]).toMatchObject({ text: 'cancel', lang: 'en-US', voice: { localService: true } });
  props.word = 'apple'; await nextTick(); expect(synth.cancel).toHaveBeenCalled();
});
it('does not send a word to a remote voice and ignores stale IPA', async () => {
  synth.getVoices.mockReturnValue([{ lang: 'en-US', localService: false }]);
  let resolve!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ us: '/new/' });
  const props = await mount(); expect(root.querySelector('button')!.disabled).toBe(true);
  props.word = 'apple'; await nextTick(); await nextTick(); resolve({ us: '/stale/' }); await nextTick();
  expect(root.textContent).toContain('/new/'); expect(root.textContent).not.toContain('/stale/'); expect(synth.speak).not.toHaveBeenCalled();
});

it('autoplays only while active, stops on pause, and ignores cancelled voice callbacks', async () => {
  const props = await mount(true, true);
  expect(synth.speak).toHaveBeenCalledTimes(1);
  const first = synth.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
  const lateStart = first.onstart;
  first.onstart?.call(first, {} as SpeechSynthesisEvent); await nextTick();
  expect(root.querySelector('.is-speaking')).not.toBeNull();
  expect(root.querySelector('.practice-ipa')?.getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.practice-ipa')?.hasAttribute('title')).toBe(false);
  props.active = false; await nextTick();
  expect(synth.cancel).toHaveBeenCalled(); expect(root.querySelector('.is-speaking')).toBeNull();
  props.word = 'apple'; await nextTick(); expect(synth.speak).toHaveBeenCalledTimes(1);
  props.active = true; await nextTick(); expect(synth.speak).toHaveBeenCalledTimes(2);
  lateStart?.call(first, {} as SpeechSynthesisEvent); await nextTick();
  expect(root.querySelector('.is-speaking')).toBeNull();
});
it('plays once when device voices arrive, bounds stalls and permits retry', async () => {
  vi.useFakeTimers(); synth.getVoices.mockReturnValue([]);
  await mount(true); expect(synth.speak).not.toHaveBeenCalled();
  expect(root.querySelector('[role=status]')?.textContent).toContain('暂无本地美式语音');
  synth.getVoices.mockReturnValue([{ lang: 'en-US', localService: true }]);
  synth.dispatchEvent(new Event('voiceschanged')); await nextTick();
  synth.dispatchEvent(new Event('voiceschanged')); expect(synth.speak).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8000); expect(root.textContent).toContain('发音播放超时');
  root.querySelector('button')!.click(); expect(synth.speak).toHaveBeenCalledTimes(2);
});
