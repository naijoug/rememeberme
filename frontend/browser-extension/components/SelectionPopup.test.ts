import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SelectionPopup from './SelectionPopup.vue';

let app: App;
let host: HTMLElement;
afterEach(() => { app?.unmount(); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lookup card interaction and viewport fit', () => {
  it('places actions beside the word outside the scrollable reading body', async () => {
    const remember = vi.fn();
    const forget = vi.fn();
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'technical', visible: true, position: { x: 250, y: 200 }, definition: { word: 'technical', phonetics: [], meanings: [] }, onRemember: remember, onForget: forget });
    app.mount(host); await nextTick();
    expect(host.querySelector('.lookup-header .word')?.textContent).toBe('technical');
    expect(host.querySelector('.lookup-body .lookup-actions')).toBeNull();
    host.querySelector<HTMLButtonElement>('.lookup-header .btn-remember')!.click();
    host.querySelector<HTMLButtonElement>('.lookup-header .btn-forget')!.click();
    expect(remember).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledTimes(1);
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
    expect(host.querySelector<HTMLButtonElement>('.btn-forget')?.disabled).toBe(true);
  });

  it('keeps the word visible on failure and exposes retry instead of save', async () => {
    const retry = vi.fn();
    host = document.createElement('div'); document.body.appendChild(host);
    app = createApp(SelectionPopup, { word: 'multiple', visible: true, error: 'Please try again.', position: { x: 200, y: 20 }, onRetry: retry });
    app.mount(host); await nextTick();
    expect(host.querySelector('.word')?.textContent).toBe('multiple');
    expect(host.querySelector('.btn-forget')).toBeNull();
    host.querySelector<HTMLButtonElement>('.retry-btn')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
