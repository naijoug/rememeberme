import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyReleaseDirectory } from './release-integrity.mjs';

it('rejects missing popup and transitive JS/CSS assets before accepting a complete package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rememberme-package-test-'));
  try {
    const manifest = { manifest_version: 3, version: '0.1.1', permissions: ['storage', 'contextMenus'], action: { default_popup: 'popup.html' }, background: { service_worker: 'background.js' } };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(verifyReleaseDirectory(root, '0.1.1')).rejects.toThrow();
    await writeFile(join(root, 'popup.html'), '<script type="module" src="/popup.js"></script><link href="style.css" rel="stylesheet">');
    await writeFile(join(root, 'popup.js'), 'import "./shared.js";');
    await writeFile(join(root, 'background.js'), 'console.log("fixture");');
    await expect(verifyReleaseDirectory(root, '0.1.1')).rejects.toThrow();
    await writeFile(join(root, 'shared.js'), 'export const fixture = 1;');
    await writeFile(join(root, 'style.css'), 'body{background:url(icon.svg)}');
    await expect(verifyReleaseDirectory(root, '0.1.1')).rejects.toThrow();
    await writeFile(join(root, 'icon.svg'), '<svg/>');
    expect((await verifyReleaseDirectory(root, '0.1.1')).files).toHaveLength(7);
    await writeFile(join(root, 'popup.js'), 'import "http://127.0.0.1:3937/entrypoints/popup/main.ts";');
    await expect(verifyReleaseDirectory(root, '0.1.1')).rejects.toThrow('Development/temporary endpoint');
    await writeFile(join(root, 'popup.js'), 'import "../escaped.js";');
    await expect(verifyReleaseDirectory(root, '0.1.1')).rejects.toThrow('outside package');
  } finally { await rm(root, { recursive: true, force: true }); }
});
