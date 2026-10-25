import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import SelectionPopup from './SelectionPopup.vue';
vi.mock('~/services/lookup-client', () => ({ requestPhonetics: vi.fn().mockResolvedValue({}) }));

let app: App;
let host: HTMLElement;
afterEach(() => { app?.unmount(); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lookup card interaction and viewport fit', () => {
  it('plays pronunciation without recording and stops it when the card closes', async () => {
    const record = vi.fn();
    const synth = { getVoices: () => [{ lang: 'en-US', localService: true }], speak: vi.fn(), cancel: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const state = reactive({ visible: true });
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp({ render: () => h(SelectionPopup, { word: 'apple', visible: state.visible, position: { x: 200, y: 20 }, onRecord: record, onClose: () => { state.visible = false; } }) });
    app.mount(host); await nextTick();
    host.querySelector<HTMLButtonElement>('.lookup-header .pronunciation-button')!.click();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('[aria-label="Close definition"]')!.click(); await nextTick();
    expect(host.querySelector('.vocab-counter-popup')).toBeNull();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.removeEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
  });

  it('places actions beside the word outside the scrollable reading body', async () => {
    const record = vi.fn();
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'technical', visible: true, position: { x: 250, y: 200 }, savedWord: { word: 'technical', count: 3, history: [], createdAt: 1, updatedAt: 1 }, definition: { word: 'technical', phonetics: [], meanings: [] }, onRecord: record });
    app.mount(host); await nextTick();
    expect(host.querySelector('.lookup-header .word')?.textContent).toBe('technical');
    expect(host.querySelector('.lookup-body .lookup-actions')).toBeNull();
    expect(host.querySelector('.record-count')?.textContent).toBe('3');
    expect(host.querySelector('.btn-remember, .btn-forget')).toBeNull();
    host.querySelector<HTMLButtonElement>('.lookup-header .record-button')!.click();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('replaces the bookmark with a spinner, then a solid bookmark and blocks repeat actions', async () => {
    const record = vi.fn();
    const state = reactive({ saving: false, recorded: false });
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp({ render: () => h(SelectionPopup, { word: 'apple', visible: true, position: { x: 200, y: 20 }, ...state, onRecord: record }) });
    app.mount(host); await nextTick();
    const button = host.querySelector<HTMLButtonElement>('.record-button')!;
    const outline = button.querySelector('svg')!.innerHTML;
    state.saving = true; await nextTick();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button.querySelector('.record-icon.rm-spinner')).not.toBeNull();
    button.click();
    state.saving = false; state.recorded = true; await nextTick();
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.rm-spinner')).toBeNull();
    expect(button.querySelector('svg')!.innerHTML).not.toBe(outline);
    expect(button.getAttribute('aria-label')).toContain('Recorded apple');
    button.click();
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps controls in place when content grows after the reader enters the card', async () => {
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 700);
    let height = 120;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 420, height } as DOMRect));
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'technical', visible: true, loading: true, position: { x: 250, y: 420, anchorTop: 410 } });
    app.mount(host); await nextTick();
    const card = host.querySelector<HTMLElement>('.vocab-counter-popup')!;
    expect(card.style.top).toBe('420px');
    card.dispatchEvent(new Event('pointerenter'));
    height = 480;
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(card.style.top).toBe('420px');
    expect(card.style.maxHeight).toBe('268px');
  });

  it('moves above the selection and stays inside a narrow viewport', async () => {
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 640);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 336, height: 220 } as DOMRect);
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'apple', visible: true, loading: true, position: { x: 10, y: 630, anchorTop: 600 } });
    app.mount(host); await nextTick();
    const card = host.querySelector<HTMLElement>('.vocab-counter-popup')!;
    expect(card.style.left).toBe('12px');
    expect(card.style.top).toBe('370px');
    expect(host.querySelector<HTMLButtonElement>('.record-button')?.disabled).toBe(false);
  });

  it('keeps recording available when lookup fails, with a separate retry action', async () => {
    const retry = vi.fn();
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'multiple', visible: true, error: 'Please try again.', position: { x: 200, y: 20 }, onRetry: retry });
    app.mount(host); await nextTick();
    expect(host.querySelector('.word')?.textContent).toBe('multiple');
    expect(host.querySelector<HTMLButtonElement>('.record-button')?.disabled).toBe(false);
    host.querySelector<HTMLButtonElement>('.retry-btn')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
