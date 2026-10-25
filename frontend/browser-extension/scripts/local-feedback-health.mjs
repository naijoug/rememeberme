import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function toolchainFingerprint(packageJSON, lockfile, nodeVersion) {
  return createHash('sha256').update(JSON.stringify([nodeVersion, packageJSON, lockfile])).digest('hex');
}

export async function bootstrapWithRetry(bootstrap, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let result;
  for (let attempt = 0; attempt < 6; attempt++) {
    result = bootstrap();
    // launchd can report EIO briefly while an old job is still unloading.
    if (result.error || result.status !== 5 || !/input\/output error/i.test(result.stderr ?? '')) return result;
    if (attempt < 5) await pause(500);
  }
  return result;
}

export async function checkFeedbackFiles(outputDirectory = fileURLToPath(new URL('../.output/chrome-mv3-feedback', import.meta.url))) {
  const root = resolve(outputDirectory);
  async function requireFile(path, parent = root) {
    if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('Invalid local feedback entrypoint path');
    const target = resolve(parent, path);
    const fromRoot = relative(root, target);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('Local feedback asset escaped its output directory');
    if (!(await stat(target)).isFile()) throw new Error('Local feedback asset is not a file: ' + path);
    return target;
  }
  try {
    const manifest = JSON.parse(await readFile(await requireFile('manifest.json'), 'utf8'));
    const popup = await requireFile(manifest.action?.default_popup);
    await requireFile(manifest.background?.service_worker);
    const html = await readFile(popup, 'utf8');
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
      if (/^https?:\/\//.test(match[1])) continue;
      const path = match[1].split(/[?#]/)[0];
      await requireFile(path.replace(/^\//, ''), path.startsWith('/') ? root : dirname(popup));
    }
  } catch (error) { throw new Error('Local feedback output is incomplete: ' + error.message); }
}

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
