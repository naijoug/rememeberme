import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from 'vue';
import HighlightedText from './HighlightedText.vue';

let app: App;
let host: HTMLElement;
afterEach(() => { app?.unmount(); host?.remove(); });
describe('dictionary example highlighting', () => {
  it('renders imported markup literally and highlights only the selected word', () => {
    host = document.createElement('div');
    app = createApp(HighlightedText, { text: '<img src=x> multiple sources', word: 'multiple' });
    app.mount(host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('mark')?.textContent).toBe('multiple');
    expect(host.textContent).toBe('<img src=x> multiple sources');
  });
  it('does not crash on legacy optional example objects', () => {
    host = document.createElement('div');
    app = createApp(HighlightedText, { text: { toString: 'not executable' }, word: 'multiple' });
    expect(() => app.mount(host)).not.toThrow();
    expect(host.textContent).toBe('');
  });
});
