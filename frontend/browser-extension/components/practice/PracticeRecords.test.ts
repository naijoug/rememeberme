import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import PracticeRecords from './PracticeRecords.vue';
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); sessionStorage.clear(); });
it('pins the clear confirmation to its original scope and revision', async () => {
  sessionStorage.clear();
  const messages: any[] = [];
  const view = { scope: 'boot:1', owner: 'account:first', revision: 7, label: 'GitHub · first' };
  vi.stubGlobal('browser', { runtime: { sendMessage: async (message: any) => {
    messages.push(structuredClone(message));
    if (message.type === 'PRACTICE_GET') return { success: true, data: structuredClone(view) };
    return { success: false, error: 'The vocabulary changed. Reopen confirmation.' };
  } } });
  root = document.createElement('div'); document.body.append(root); app = createApp(PracticeRecords); app.mount(root);
  root.querySelector('button')!.click();
  await vi.waitFor(() => expect(root.querySelector('[role=dialog]')).not.toBeNull());
  expect(root.textContent).toContain('GitHub · first');
  view.scope = 'boot:2'; view.owner = 'account:second'; view.revision = 8;
  const confirm = [...root.querySelectorAll('button')].find(b => b.textContent === 'Clear records')!;
  confirm.click(); await nextTick();
  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages[1]).toMatchObject({ owner: 'account:first', scope: 'boot:1', revision: 7, action: { kind: 'clear' } });
});
