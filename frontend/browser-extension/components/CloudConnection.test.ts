import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import CloudConnection from './CloudConnection.vue';
import { SERVICE_ORIGIN } from '~/config/backend';
import type { CloudStatus } from '~/services/cloud-vocabulary';
let app: App, container: HTMLDivElement;
const initial = (): CloudStatus => ({ connected: true, origin: 'https://api.example.test', owner: 'account:fixture',
  displayName: 'synthetic-github', enabled: false, pending: 2, conflicts: 0, localWords: 1, archives: [] });
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

it('shows the GitHub username and a preview before confirming only new words', async () => {
  const plan = { token: 'a'.repeat(64), displayName: 'synthetic-github', total: 2, copy: 1, skip: 1,
    items: [{ word: '<script>literal</script>', count: 0.5, histories: 2, action: 'copy' }, { word: 'existing', count: 4, histories: 1, action: 'skip' }] };
  const send = vi.fn().mockImplementation(async request => ({ success: true, data: request.type === 'CLOUD_PREVIEW_LOCAL' ? plan : initial() }));
  const confirm = vi.fn().mockReturnValue(false); vi.stubGlobal('confirm', confirm);
  await mount(send);
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'CLOUD_STATUS' });
  expect(container.textContent).toContain('@synthetic-github');
  button('Preview local').click(); await tick(); await tick();
  expect(container.textContent).toContain('2 local words · 1 new · 1 skipped');
  expect(document.activeElement).toBe(container.querySelector('.migration-preview'));
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<script>literal</script>');
  expect(send.mock.calls.some(([request]) => request.type === 'CLOUD_COPY_LOCAL')).toBe(false);
  button('Confirm copy').click(); await tick();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('@synthetic-github'));
  expect(send.mock.calls.some(([request]) => request.type === 'CLOUD_COPY_LOCAL')).toBe(false);
  confirm.mockReturnValue(true);
  button('Confirm copy').click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_COPY_LOCAL', previewToken: plan.token });
  expect(send.mock.calls.some(([request]) => request.type === 'CLOUD_ENABLE')).toBe(false);
});

it('allows cancelling a preview without copying or enabling sync', async () => {
  const send = vi.fn().mockImplementation(async request => ({ success: true, data: request.type === 'CLOUD_PREVIEW_LOCAL'
    ? { token: 'a'.repeat(64), displayName: 'synthetic', total: 0, copy: 0, skip: 0, items: [] } : initial() }));
  await mount(send); button('Preview local').click(); await tick(); await tick();
  expect(button('Confirm copy').disabled).toBe(true);
  button('Cancel preview').click(); await tick();
  expect(container.querySelector('.migration-preview')).toBeNull();
  expect(send.mock.calls.some(([request]) => ['CLOUD_COPY_LOCAL', 'CLOUD_ENABLE'].includes(request.type))).toBe(false);
});

it('refreshes the paused conflict state after a failed sync and confirms full recovery before sending', async () => {
  let status = { ...initial(), enabled: true };
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
  expect(container.textContent).toContain('1 conflict');
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


it('renders account and sync metadata as read-only list rows and toggles sync explicitly', async () => {
  let status = initial();
  const send = vi.fn().mockImplementation(async request => {
    if (request.type === 'CLOUD_ENABLE') status = { ...status, enabled: request.enabled };
    return { success: true, data: status };
  });
  await mount(send);
  const control = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(control.getAttribute('aria-labelledby')).toBe('cloud-sync-label');
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect([...container.querySelectorAll('dl')].map(row => row.textContent)).toEqual(expect.arrayContaining([
    expect.stringContaining('@synthetic-github'), expect.stringContaining('GitHub account'), expect.stringContaining('2 pending · 0 conflicts'),
  ]));
  expect(container.querySelector('dl button')).toBeNull();
  expect(button('Sync now').disabled).toBe(true);
  control.click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_ENABLE', enabled: true });
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(button('Sync now').disabled).toBe(false);
  control.click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_ENABLE', enabled: false });
  expect(control.getAttribute('aria-checked')).toBe('false');
});

it('keeps sync disabled for local vocabulary without silently switching or copying it', async () => {
  const send = vi.fn().mockResolvedValue({ success: true, data: { ...initial(), owner: 'anonymous' } });
  await mount(send);
  const control = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(control.disabled).toBe(true);
  expect(container.textContent).toContain('Open account vocabulary to enable sync.');
  expect(container.textContent).toContain('Local only');
  expect(button('Use local vocabulary')).toBeUndefined();
  expect(button('Sync now')).toBeUndefined();
  control.click(); await tick();
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'CLOUD_STATUS' });
  button('Open account vocabulary').click(); await tick();
  expect(send).toHaveBeenLastCalledWith({ type: 'CLOUD_OPEN' });
  expect(send.mock.calls.some(([request]) => ['CLOUD_ENABLE', 'CLOUD_COPY_LOCAL'].includes(request.type))).toBe(false);
});

it('prevents duplicate toggle requests and restores the confirmed state after failure', async () => {
  let complete!: (reply: unknown) => void;
  const send = vi.fn().mockImplementation(request => request.type === 'CLOUD_ENABLE'
    ? new Promise(resolve => { complete = resolve; })
    : Promise.resolve({ success: true, data: initial() }));
  await mount(send);
  const control = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  control.click(); await tick();
  expect(control.disabled).toBe(true);
  control.click(); await tick();
  expect(send.mock.calls.filter(([request]) => request.type === 'CLOUD_ENABLE')).toHaveLength(1);
  complete({ success: false, error: 'Connection unavailable' });
  await tick(); await tick();
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(control.disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection unavailable');
});

it('disables enabling sync when recovery is required and preserves the recovery action', async () => {
  const send = vi.fn().mockResolvedValue({ success: true, data: { ...initial(), conflicts: 1, failure: 'VERSION_CONFLICT' } });
  await mount(send);
  expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  expect(container.textContent).toContain('Needs attention');
  expect(button('Archive changes')).toBeDefined();
});
