import { describe, expect, it, vi } from 'vitest';
import { checkFeedbackAssets, checkFeedbackFiles, readLaunchAgentState, serviceStartAction, toolchainFingerprint, bootstrapWithRetry } from './local-feedback-health.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('local feedback service health', () => {
  it('requires the popup, background and referenced local chunks on disk even when Vite is healthy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rememberme-health-'));
    try {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ action: { default_popup: 'popup.html' }, background: { service_worker: 'background.js' } }));
      await writeFile(join(root, 'background.js'), 'export {}');
      await expect(checkFeedbackFiles(root)).rejects.toThrow('output is incomplete');
      await writeFile(join(root, 'popup.html'), '<script src="http://127.0.0.1:3937/main.ts"></script><script src="/chunks/popup.js"></script>');
      await expect(checkFeedbackFiles(root)).rejects.toThrow('output is incomplete');
      await mkdir(join(root, 'chunks')); await writeFile(join(root, 'chunks/popup.js'), 'export {}');
      await expect(checkFeedbackFiles(root)).resolves.toBeUndefined();
      await rm(join(root, 'background.js'));
      await expect(checkFeedbackFiles(root)).rejects.toThrow('output is incomplete');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('replaces a running watcher when dependencies or Node change, and reuses an identical toolchain', () => {
    const initial = toolchainFingerprint('{"version":"0.1.0"}', 'lock-v1', 'v22.22.3');
    expect(toolchainFingerprint('{"version":"0.1.0"}', 'lock-v1', 'v22.22.3')).toBe(initial);
    expect(serviceStartAction({ registered: true, running: true }, toolchainFingerprint('{"version":"0.1.0"}', 'lock-v2', 'v22.22.3') !== initial)).toBe('replace');
    expect(toolchainFingerprint('{"version":"0.1.0"}', 'lock-v1', 'v22.23.2')).not.toBe(initial);
  });

  it('retries transient launchd unloading EIO but never retries a permission error', async () => {
    const bootstrap = vi.fn().mockReturnValueOnce({ status: 5, stderr: 'Bootstrap failed: 5: Input/output error' }).mockReturnValue({ status: 0 });
    const pause = vi.fn().mockResolvedValue(undefined);
    expect((await bootstrapWithRetry(bootstrap, pause)).status).toBe(0);
    expect(bootstrap).toHaveBeenCalledTimes(2); expect(pause).toHaveBeenCalledExactlyOnceWith(500);
    const denied = vi.fn().mockReturnValue({ status: 1, stderr: 'Operation not permitted' });
    expect((await bootstrapWithRetry(denied, pause)).status).toBe(1); expect(denied).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn().mockReturnValue({ status: 5, stderr: 'Input/output error' });
    expect((await bootstrapWithRetry(unavailable, pause)).status).toBe(5); expect(unavailable).toHaveBeenCalledTimes(6);
  });
  it('recovers a registered process that exited cleanly instead of reporting it as started', () => {
    const result = readLaunchAgentState({ status: 0, stdout: 'job = {\n\tstate = not running\n\tlast exit code = 0\n\tresource coalition = {\n\t\tstate = active\n\t}\n}', stderr: '' });
    expect(result).toEqual({ registered: true, running: false, state: 'not running' });
    expect(serviceStartAction(result, false)).toBe('kickstart');
  });

  it('reuses a running service and replaces it only when its configuration changes', () => {
    const current = readLaunchAgentState({ status: 0, stdout: '\tstate = running\n\tpid = 123\n', stderr: '' });
    expect(serviceStartAction(current, false)).toBe('reuse');
    expect(serviceStartAction(current, true)).toBe('replace');
  });

  it('distinguishes an absent job from a permission failure', () => {
    const absent = readLaunchAgentState({ status: 113, stdout: '', stderr: 'Could not find service "example" in domain' });
    expect(serviceStartAction(absent, true)).toBe('bootstrap');
    expect(() => readLaunchAgentState({ status: 1, stdout: '', stderr: 'Operation not permitted' })).toThrow('Operation not permitted');
  });

  it('requires both scripts actually referenced by the popup to be reachable', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('export {}', { headers: { 'content-type': 'text/javascript' } }));
    await checkFeedbackAssets(fetcher);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'http://127.0.0.1:3937/@vite/client', 'http://127.0.0.1:3937/entrypoints/popup/main.ts',
    ]);
  });

  it.each([404, 500, 200])('rejects missing assets or an unrelated HTML server (HTTP %s)', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html></html>', { status, headers: { 'content-type': 'text/html' } }));
    await expect(checkFeedbackAssets(fetcher)).rejects.toThrow('Local feedback asset unavailable');
  });
});
