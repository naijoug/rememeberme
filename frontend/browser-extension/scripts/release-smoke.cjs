// Formal ZIP acceptance in a disposable Chrome for Testing profile.
// Never attaches to the user's Chrome or reads real vocabulary.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const assets = process.env.REMEMBERME_ACCEPTANCE_DIR || path.join(root, 'docs/release/assets');
const article = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Remember Me release acceptance</title><style>body{margin:0;background:#f7f6f2;color:#273343;font-family:Georgia,serif}main{max-width:760px;margin:65px auto}small{font:13px system-ui;letter-spacing:2px;color:#526c91}h1{font-size:42px}p{font-size:24px;line-height:1.9}</style><main><small>READING NOTES · DISPOSABLE EXAMPLE</small><h1>A pleasant discovery</h1><p>A quiet afternoon brings a little <span id="target">serendipity</span>.</p><p>Some ideas are <span id="second">ephemeral</span>, but an encounter can stay in your vocabulary.</p></main></html>`;
(async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-release-acceptance-'));
  const profile = path.join(fixture, 'profile'), extension = path.join(fixture, 'extension');
  await mkdir(extension); await mkdir(profile); await mkdir(assets, { recursive: true });
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const zip = path.join(root, `.output/remember-me-${version}-chrome.zip`);
  execFileSync('unzip', ['-q', zip, '-d', extension]);
  const expectedManifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  assert.deepEqual(expectedManifest.permissions, ['storage', 'contextMenus', 'identity', 'alarms']);
  assert.ok(!JSON.stringify(expectedManifest).includes('localhost') && !JSON.stringify(expectedManifest).includes('3937'));
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(article); });
  let context, shadowSession;
  const results = { version, checks: [], limitations: ['Native toolbar anchoring and browser-native right-click menu are separate manual checks.', 'Cloud account controls are enabled; this smoke run does not verify authenticated synchronization.', 'This exercises a disposable Chrome for Testing profile, not the user profile or Chrome Web Store review.'] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/reading-example`;
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context.setDefaultTimeout(25000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    results.browser = context.browser().version(); results.extensionId = id;
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.deepEqual(manifest, expectedManifest);
    const proxyRequests = [];
    const directRequests = [];
    await context.route(/https:\/\/(?:api\.mymemory\.translated\.net|api\.dictionaryapi\.dev)\//, async route => { directRequests.push(route.request().url()); await route.abort(); });
    context.on('request', req => { if (req.url().includes('/api/v1/public/lookup/')) proxyRequests.push({ url: req.url(), method: req.method(), body: req.postData() }); });
    const page = await context.newPage(); await page.goto(url);
    shadowSession = await context.newCDPSession(page);
    // Read the real closed shadow tree through test-owned browser DevTools only.
    // Production never exposes or changes its closed-shadow encapsulation.
    async function cardText() {
      const { root: tree } = await shadowSession.send('DOM.getDocument', { depth: -1, pierce: true });
      function search(node) {
        const attrs = node.attributes || [];
        const host = attrs.includes('vocab-counter-popup-root');
        if (host) {
          const collect = n => (n.nodeType === 3 ? n.nodeValue : '') + [...(n.children || []), ...(n.shadowRoots || [])].map(collect).join(' ');
          return collect(node);
        }
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = search(child); if (found !== null) return found; }
        return null;
      }
      return search(tree) || '';
    }
    async function clickCard(label) {
      const { root: tree } = await shadowSession.send('DOM.getDocument', { depth: -1, pierce: true });
      function find(node) {
        const attrs = Object.fromEntries((node.attributes || []).reduce((a, v, i, arr) => { if (i % 2 === 0) a.push([v, arr[i + 1]]); return a; }, []));
        if (node.nodeName === 'BUTTON' && attrs['aria-label'] === label) return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = find(child); if (found) return found; }
      }
      const node = find(tree); assert.ok(node, 'Missing card button ' + label);
      const { model } = await shadowSession.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
      const q = model.border; await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
    }
    const poll = async check => { const end = Date.now() + 25000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Acceptance condition timed out'); };
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    const message = data => popup.evaluate(data => chrome.runtime.sendMessage(data), data);
    const getWords = async () => { const reply = await message({ type: 'GET_WORDS' }); assert.equal(reply.success, true); return reply.data; };
    // IDs and current-definition flags are presentation metadata, excluded by the legacy JSON contract.
    const legacyWords = words => words.map(({ id, currentDefinition, countKnown, ...word }) => word);
    assert.deepEqual(await getWords(), []);
    await page.locator('#target').dblclick();
    try { await poll(async () => /WordNet/.test(await cardText()) && /Online translation.*(?:Magpie|Hermes|MyMemory)/.test(await cardText())); }
    catch (error) {
      console.error('Synthetic card state:', await cardText());
      console.error('Synthetic lookup requests:', proxyRequests);
      await page.screenshot({ path: path.join(fixture, 'failed-selection.png') });
      throw error;
    }
    const firstText = await cardText(); assert.ok(!/https:\/\/|Sign in|API address/.test(firstText));
    assert.deepEqual(await getWords(), []);
    results.checks.push('Exact extracted ZIP loaded in clean Chrome; live no-login translation, packaged definition and hidden service address passed.');
    await page.screenshot({ path: path.join(assets, 'screenshot-selection.png') });
    for (let i = 0; i < 2; i++) {
      if (i > 0) {
        await page.keyboard.press('Escape');
        await page.locator('#target').dblclick();
        await poll(async () => /WordNet/.test(await cardText()));
      }
      await clickCard(`Add a record for serendipity, count ${i}`);
      await poll(async () => (await getWords())[0]?.count === i + 1);
    }
    await poll(async () => (await getWords())[0]?.count === 2);
    const saved = await getWords(); assert.equal(saved[0].history.length, 2); assert.equal(saved[0].history[0].url, url);
    assert.match(saved[0].history[0].context, /serendipity/);
    assert.ok(['magpie', 'hermes', 'mymemory'].includes(saved[0].history[0].definition.translation?.source));
    results.translationSource = saved[0].history[0].definition.translation.source;
    results.checks.push('One bookmark click per separately opened popup saved count 2, two histories, translation source, fixture sentence and source URL.');
    await page.keyboard.press('Escape');
    await page.locator('#second').dblclick(); await poll(async () => /ephemeral/.test(await cardText()) && /WordNet/.test(await cardText()));
    assert.equal((await getWords()).length, 1); await page.keyboard.press('Escape');
    await popup.reload(); await popup.setViewportSize({ width: 400, height: 600 });
    await popup.getByRole('heading', { name: 'Remember Me', exact: true }).waitFor();
    assert.equal(await popup.locator('.cloud-connection').count(), 0); assert.equal(await popup.locator('[aria-label="HTTPS API address"]').count(), 0);
    await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await popup.getByRole('heading', { name: 'Setting', exact: true }).count(), 1);
    assert.equal(await popup.getByRole('button', { name: 'Sign in with GitHub' }).count(), 1); await popup.keyboard.press('Escape');
    await popup.locator('.word-header').click(); await popup.getByRole('button', { name: 'Reset count', exact: true }).click();
    await poll(async () => (await getWords())[0]?.count === 0);
    assert.equal((await getWords())[0].history.length, 2);
    await popup.getByRole('button', { name: 'Delete', exact: true }).click(); await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await getWords()).length, 1);
    const downloadPromise = popup.waitForEvent('download'); await popup.getByRole('button', { name: 'Settings', exact: true }).click();
    await popup.getByRole('button', { name: 'Export vocabulary', exact: true }).click();
    const download = await downloadPromise, backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(backup, legacyWords(await getWords()));
    await popup.keyboard.press('Escape');
    await popup.getByRole('button', { name: 'Delete', exact: true }).click(); await popup.locator('.confirm-btn').click();
    await poll(async () => !(await getWords()).length);
    await popup.locator('input[type=file]').setInputFiles({ name: 'fixture-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await poll(async () => (await getWords()).length === 1); assert.deepEqual(legacyWords(await getWords()), backup);
    await popup.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await popup.locator('[role=alert]').waitFor(); assert.deepEqual(legacyWords(await getWords()), backup);
    await popup.reload(); await popup.locator('.word-header').click();
    await popup.screenshot({ path: path.join(assets, 'popup-verification.png') });
    results.checks.push('Popup reset retains history; deletion cancel/confirm, export/import, malformed import, reload persistence and absent sync/API controls passed.');
    for (const req of proxyRequests) {
      assert.equal(req.method, 'POST'); const body = JSON.parse(req.body);
      assert.deepEqual(Object.keys(body).sort(), req.url.endsWith('/translation') ? ['target', 'word'] : ['word']);
    }
    assert.ok(proxyRequests.some(req => req.url.endsWith('/translation')));
    assert.deepEqual(directRequests, []);
    results.checks.push('Live requests used only internal lookup paths and exact word/target bodies; no context/URL/vocabulary upload.');
    await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 400, height: 600 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/popup.html`);
    await reopened.locator('.word-header').waitFor();
    const restart = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_WORDS' }));
    assert.deepEqual(legacyWords(restart.data), backup); results.checks.push('Real browser process restart preserved counts/history from the extracted formal ZIP.');
    await context.close(); context = undefined;
    const legacy = [{ word: 'synthetic', count: 0.5, createdAt: 1, updatedAt: 2,
      history: [{ timestamp: 2, context: '<img src=x onerror=alert(1)> synthetic literal', url: 'javascript:alert(1)',
        definition: { word: 'synthetic', phonetics: [], meanings: [] } }] }];
    context = await chromium.launchPersistentContext(path.join(fixture, 'legacy-profile'), { headless: true, channel: 'chromium', viewport: { width: 400, height: 600 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const legacyWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await legacyWorker.evaluate(words => chrome.storage.local.set({ words }), legacy);
    const migrated = await context.newPage(); await migrated.goto(`chrome-extension://${id}/popup.html`);
    await migrated.locator('.word-header').waitFor();
    assert.deepEqual(legacyWords((await migrated.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_WORDS' }))).data), legacy);
    assert.deepEqual(await legacyWorker.evaluate(async () => (await chrome.storage.local.get('words')).words), legacy);
    await migrated.locator('.word-header').click();
    await migrated.locator('.record-summary').click();
    assert.match(await migrated.locator('.context-text').innerText(), /<img src=x onerror=alert\(1\)> synthetic literal/);
    assert.equal(await migrated.locator('.context-text img').count(), 0);
    assert.equal(await migrated.locator('a[href^="javascript:"]').count(), 0);
    await migrated.getByRole('button', { name: 'Reset count', exact: true }).click();
    const afterReset = await migrated.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_WORDS' }));
    assert.equal(afterReset.data[0].count, 0); assert.deepEqual(afterReset.data[0].history, legacy[0].history);
    results.checks.push('Actual chrome.storage legacy upgrade retained fractional count, literal HTML/non-HTTP source and original snapshot; migrated count reset retained history.');
    await writeFile(path.join(assets, 'release-acceptance.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
