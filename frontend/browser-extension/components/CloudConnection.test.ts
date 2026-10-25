import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import CloudConnection from './CloudConnection.vue';
import { SERVICE_ORIGIN } from '~/config/backend';
import type { CloudStatus } from '~/services/cloud-vocabulary';
let app: App, container: HTMLDivElement;
const initial = (): CloudStatus => ({ connected: true, origin: 'https://api.example.test', owner: 'account:fixture',
  enabled: false, pending: 2, conflicts: 0, localWords: 1, archives: [] });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick(); };
function button(text: string) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text))!;
}
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { app?.unmount(); container.remove(); vi.unstubAllGlobals(); });
async function mount(send: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('browser', { runtime: { sendMessage: send } });
  app = createApp({ render: () => h(CloudConnection) }); app.mount(container); await tick();

}

it('requires an explicit copy confirmation and does not send copy or enable from mounting', async () => {
  const send = vi.fn().mockResolvedValue({ success: true, data: initial() });
  const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal('confirm', confirm);
  await mount(send);
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'CLOUD_STATUS' });
  button('Copy local').click(); await tick();
  expect(confirm).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  button('Copy local').click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_COPY_LOCAL' });
  expect(send.mock.calls.some(([request]) => request.type === 'CLOUD_ENABLE')).toBe(false);
});

it('refreshes the paused conflict state after a failed sync and confirms full recovery before sending', async () => {
  let status = initial();
  const send = vi.fn().mockImplementation(async request => {
    if (request.type === 'CLOUD_SYNC') {
      status = { ...status, enabled: false, conflicts: 1, failure: 'VERSION_CONFLICT' };
      return { success: false, error: 'VERSION_CONFLICT' };
    }
    return { success: true, data: status };
  });
  const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal('confirm', confirm);
  await mount(send);
  button('Sync now').click(); await tick(); await tick();
  expect(container.textContent).toContain('1 conflicts');
  expect(container.querySelector('[role=alert]')?.textContent).toContain('VERSION_CONFLICT');
  button('Archive changes').click(); await tick();
  expect(send.mock.calls.some(([request]) => request.type === 'CLOUD_RECOVER')).toBe(false);
  confirm.mockReturnValue(true);
  button('Archive changes').click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_RECOVER' });
});

it('keeps service addresses hidden and uses the configured origin only for optional sync sign-in', async () => {
  const send = vi.fn().mockResolvedValue({ success: true, data: { ...initial(), connected: false } });
  await mount(send);
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).not.toContain('https://');
  expect(container.textContent).toContain('Translation works without signing in');
  button('Sign in with GitHub').click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_CONNECT', origin: SERVICE_ORIGIN });
});
