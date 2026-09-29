export function readLaunchAgentState(result) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/could not find service|service not found/i.test(result.stderr ?? '')) return { registered: false, running: false, state: 'not registered' };
    throw new Error(result.stderr || result.stdout || 'Could not inspect the local feedback service');
  }
  const state = result.stdout.match(/^\s*state = ([^\n]+)$/m)?.[1].trim() ?? 'unknown';
  return { registered: true, running: state === 'running', state };
}

export async function checkFeedbackAssets(fetcher = fetch) {
  for (const path of ['/@vite/client', '/entrypoints/popup/main.ts']) {
    const response = await fetcher(`http://127.0.0.1:3937${path}`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok || !response.headers.get('content-type')?.includes('javascript')) {
      throw new Error(`Local feedback asset unavailable: ${path} (HTTP ${response.status})`);
    }
  }
}

export function serviceStartAction(current, configChanged) {
  if (!current.registered) return 'bootstrap';
  if (configChanged) return 'replace';
  return current.running ? 'reuse' : 'kickstart';
}
