import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import SiteSettings from './SiteSettings.vue';
const watch = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock('wxt/utils/storage', () => ({ storage: { watch } }));
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function mount(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('browser', { runtime: { sendMessage } });
  root = document.createElement('div'); document.body.append(root);
  app = createApp(SiteSettings); app.mount(root);
  await nextTick(); await nextTick();
}
it('toggles the active site and restores saved sites without touching vocabulary', async () => {
  let enabled = true;
  const send = vi.fn(async (message: { type: string; enabled?: boolean }) => {
    if (message.type === 'SITE_STATUS') return { success: true, data: { hostname: 'example.test', tabId: 4, enabled,
      settings: { schemaVersion: 1, disabledHosts: enabled ? [] : ['example.test'] } } };
    enabled = message.enabled ?? true; return { success: true };
  });
  await mount(send);
  expect(root.textContent).toContain('Disable on this website');
  root.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('Enable on this website'));
  expect(send).toHaveBeenCalledWith({ type: 'SITE_SET_CURRENT', tabId: 4, hostname: 'example.test', enabled: false });
  root.querySelector<HTMLButtonElement>('[aria-label="Enable example.test"]')!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('No websites disabled.'));
  expect(send.mock.calls.every(([message]) => message.type.startsWith('SITE_'))).toBe(true);
});
it('requires a separate confirmation before restoring unreadable rules', async () => {
  const send = vi.fn(async () => ({ success: true, data: { hostname: 'example.test', enabled: false, settings: null, error: 'Newer settings version.' } }));
  await mount(send);
  const restore = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Restore website settings')!;
  restore.click(); await nextTick();
  expect(send).toHaveBeenCalledTimes(1);
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Cancel')!.click(); await nextTick();
  expect(send).toHaveBeenCalledTimes(1);
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Restore website settings')!.click(); await nextTick();
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Restore')!.click();
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'SITE_RESET' }));
});
