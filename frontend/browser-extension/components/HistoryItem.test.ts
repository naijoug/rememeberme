import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from 'vue';
import type { HistoryRecord } from '~/types';
import HistoryItem from './HistoryItem.vue';

let app: App | undefined;
let container: HTMLDivElement;

function render(context: string, word = 'apple', url = 'https://example.com/article') {
  const record: HistoryRecord = {
    timestamp: 1, context, url,
    definition: { word, phonetics: [], meanings: [] },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp(HistoryItem, { record, word, recordNumber: 2 });
  app.mount(container);
  return container;
}

afterEach(() => {
  app?.unmount();
  container?.remove();
});

describe('HistoryItem', () => {
  it('opens an individual numbered record with its precise timestamp and full source URL', () => {
    const view = render('An apple sentence.', 'apple', 'https://example.com/article?chapter=2#context');
    const details = view.querySelector<HTMLDetailsElement>('.record-entry')!;
    expect(details.open).toBe(false);
    expect(view.querySelector('.record-number')?.textContent).toBe('#2');
    view.querySelector<HTMLElement>('.record-summary')!.click();
    expect(details.open).toBe(true);
    expect(view.querySelector('time')?.getAttribute('datetime')).toBe(new Date(1).toISOString());
    expect(view.querySelector('time')?.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(view.querySelector('.context-text')?.textContent).toBe('An apple sentence.');
    expect(view.querySelector('.url-link')?.textContent).toBe('https://example.com/article?chapter=2#context');
  });

  it('renders HTML as text and highlights only matching words', () => {
    const context = '<img src=x onerror="alert(1)"> Apple & apple; pineapple.';
    const view = render(context);
    expect(view.querySelector('.context-text')?.textContent).toBe(context);
    expect(view.querySelector('img')).toBeNull();
    expect([...view.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['Apple', 'apple']);
  });

  it('treats regex characters in imported words literally', () => {
    const view = render('a+b and aaab', 'a+b');
    expect([...view.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['a+b']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'not a URL'])(
    'does not make the imported URL %s navigable', url => {
      const view = render('apple', 'apple', url);
      expect(view.querySelector('a')).toBeNull();
      expect(view.querySelector('.source-text')?.textContent).toBe(url);
    }
  );

  it('opens HTTP(S) source links in an isolated new tab', () => {
    const link = render('apple').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/article');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
