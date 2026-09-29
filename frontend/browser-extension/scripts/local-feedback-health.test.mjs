import { describe, expect, it, vi } from 'vitest';
import { checkFeedbackAssets, readLaunchAgentState, serviceStartAction } from './local-feedback-health.mjs';

describe('local feedback service health', () => {
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
