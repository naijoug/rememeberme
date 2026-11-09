import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { Translation } from '~/types';
import TranslationText from './TranslationText.vue';

let app: App | undefined;
let host: HTMLElement;
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });
const translation = (text: string): Translation => ({ text, source: 'mymemory', target: 'zh-CN' });

describe('Chinese translation display', () => {
  it('renders local translation literally without a source footer', () => {
    host = document.createElement('div');
    app = createApp(TranslationText, { translation: { text: '<img src=x> 合成', target: 'zh-CN', source: 'magpie',
      dictionary: { id: 'rememberme-dict', version: 'b'.repeat(24), entryHash: 'a'.repeat(64), review: 'ai-assisted-v1' } } });
    app.mount(host);
    expect(host.querySelector('.definition-source')).toBeNull();
    expect(host.querySelector('.translation-text')?.textContent).toBe('<img src=x> 合成');
    expect(host.querySelector('img')).toBeNull();
  });
  it('renders online translation as untrusted text without a provider footer', () => {
    host = document.createElement('div');
    app = createApp(TranslationText, { translation: { text: '<b>合成</b>', target: 'zh-CN', source: 'magpie' } });
    app.mount(host);
    expect(host.querySelector('.definition-source')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('.translation-text')?.textContent).toBe('<b>合成</b>');
  });
  it('formats existing provider/cache/history text reactively while preserving raw data', async () => {
    const original = translation('哄騙 哄骗 [hong3 pian4]');
    const props = reactive({ translation: original });
    host = document.createElement('div');
    app = createApp({ render: () => h(TranslationText, props) }); app.mount(host);
    expect(host.querySelector('.translation-text')?.textContent).toBe('哄騙 哄骗 [hǒng piàn]');
    expect(original.text).toBe('哄騙 哄骗 [hong3 pian4]');
    props.translation = translation('女 [nu:3]'); await nextTick();
    expect(host.querySelector('.translation-text')?.textContent).toBe('女 [nǚ]');
    expect(host.querySelector('.definition-source')).toBeNull();
  });

  it('keeps imported/provider markup as literal text after formatting', () => {
    host = document.createElement('div');
    app = createApp(TranslationText, { translation: translation('<img src=x onerror=alert(1)> 哄骗 [hong3 pian4]') });
    app.mount(host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.translation-text')?.textContent).toBe('<img src=x onerror=alert(1)> 哄骗 [hǒng piàn]');
  });

  it('hides malformed optional legacy translation data', () => {
    host = document.createElement('div');
    app = createApp(TranslationText, { translation: { text: { toString: 'unsafe' }, target: 'zh-CN', source: 'mymemory' } });
    expect(() => app!.mount(host)).not.toThrow();
    expect(host.querySelector('.translation-text')).toBeNull();
  });
});
