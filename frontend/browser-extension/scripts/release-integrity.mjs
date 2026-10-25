import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export async function verifyReleaseDirectory(directory, expectedVersion) {
  const root = await realpath(directory), visited = new Set();
  async function resource(reference, parent = join(root, 'manifest.json')) {
    assert.equal(typeof reference, 'string', 'Missing resource reference');
    assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference), 'Remote executable resource: ' + reference);
    const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
    const path = resolve(clean.startsWith('/') ? root : dirname(parent), clean.replace(/^\//, ''));
    const fromRoot = relative(root, path);
    assert.ok(fromRoot && !fromRoot.startsWith('..') && !isAbsolute(fromRoot), 'Resource outside package: ' + reference);
    const actual = await realpath(path);
    assert.equal(actual, path, 'Package resources must not use symlinks');
    const info = await stat(path); assert.ok(info.isFile() && info.size > 0, 'Missing/empty resource: ' + reference);
    if (visited.has(path)) return;
    visited.add(path);
    const text = /\.(?:html|js|css)$/.test(path) ? await readFile(path, 'utf8') : '';
    assert.ok(!/(?:localhost|127\.0\.0\.1):3937|\/@vite\/client|trycloudflare\.com/.test(text), 'Development/temporary endpoint in ' + fromRoot);
    if (path.endsWith('.html')) {
      for (const match of text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) await resource(match[1], path);
    } else if (path.endsWith('.js')) {
      const imports = [];
      const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          assert.ok(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]), 'Unverifiable dynamic code import in ' + fromRoot);
          imports.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
      for (const reference of imports) {
        assert.ok(reference.startsWith('.') || reference.startsWith('/'), 'Unbundled code import: ' + reference);
        await resource(reference, path);
      }
    } else if (path.endsWith('.css')) {
      for (const match of text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) {
        const reference = match[1] ?? match[2];
        if (!reference.startsWith('data:') && !reference.startsWith('#')) await resource(reference, path);
      }
    }
  }
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, expectedVersion);
  assert.deepEqual(manifest.permissions, ['storage', 'contextMenus']);
  assert.ok(!/localhost|127\.0\.0\.1|3937|unsafe-eval/.test(JSON.stringify(manifest)), 'Development manifest');
  await resource(manifest.action?.default_popup);
  await resource(manifest.background?.service_worker);
  for (const script of manifest.content_scripts ?? []) for (const reference of [...script.js ?? [], ...script.css ?? []]) await resource(reference);
  for (const reference of Object.values(manifest.icons ?? {})) await resource(reference);
  const inventory = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), name = relative(root, path).replaceAll('\\', '/');
      assert.ok(!entry.isSymbolicLink(), 'Symlink in ZIP: ' + name);
      assert.ok(!/(^|\/)(?:\.env(?:\.|$)|node_modules|\.local-feedback)|\.(?:pem|token|map)$/.test(name), 'Private/development file: ' + name);
      if (entry.isDirectory()) await walk(path);
      else { const bytes = await readFile(path); inventory.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  }
  await walk(root);
  return { version: manifest.version, checkedResources: visited.size, files: inventory.sort((a, b) => a.path.localeCompare(b.path)) };
}

export async function verifyReleaseZip(archive, expectedVersion) {
  const fixture = await mkdtemp(join(tmpdir(), 'rememberme-release-integrity-'));
  try {
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(entries.every(name => !name.startsWith('/') && !name.split('/').includes('..')), 'Unsafe ZIP member');
    execFileSync('unzip', ['-q', archive, '-d', fixture]);
    const result = await verifyReleaseDirectory(fixture, expectedVersion);
    return { ...result, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
  } finally { await rm(fixture, { recursive: true, force: true }); }
}
