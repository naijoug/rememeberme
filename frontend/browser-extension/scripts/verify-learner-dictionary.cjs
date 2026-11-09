// Reviewed dictionary acceptance in a disposable profile. Never attaches to user Chrome.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, readFile, writeFile, rm, cp } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.qa/learner-dictionary');
(async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-learner-'));
  const extension = path.join(fixture, 'extension'), profile = path.join(fixture, 'profile');
  await cp(path.join(root, '.output/chrome-mv3'), extension, { recursive: true });
  const catalog = JSON.parse(await readFile(path.join(extension, 'dictionary/rememberme/manifest.json'), 'utf8'));
  assert.equal(catalog.entries, 1000); assert.equal(catalog.reviewMethod, 'ai-assisted-v1');
  await mkdir(output, { recursive: true });
  const article = '<!doctype html><meta charset="utf-8"><title>Dictionary fixture</title><style>body{max-width:760px;margin:80px auto;font:24px/1.8 Georgia;background:#f7f6f2;color:#273343}h1{font-size:36px}</style><h1>Disposable dictionary test</h1><p>We saw an interesting <span id="target">play</span> at the theatre.</p>';
  const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(article); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  const receipt = { version: catalog.version, checked: 0, checks: [], limitations: ['Disposable Chrome profile; not the everyday installed extension.', 'No authenticated production sync or Apple UI verification.'] };
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 900 },
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP rememberme-lookup.couplelabs.workers.dev ~NOTFOUND, MAP rememberme.couplelabs.cn ~NOTFOUND'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.fixtureExternalRequests = [];
      const original = globalThis.fetch;
      globalThis.fetch = (url, init) => {
        const address = typeof url === 'string' ? url : url.url || String(url);
        if (/^https?:/.test(address)) { globalThis.fixtureExternalRequests.push(address); return Promise.reject(new Error('External network blocked in dictionary fixture')); }
        return original(url, init);
      };
    });
    const id = new URL(worker.url()).hostname, popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const send = async message => {
      const reply = await popup.evaluate(m => chrome.runtime.sendMessage(m), message);
      assert.ok(reply?.success, JSON.stringify(reply)); return reply.data;
    };
    return { worker, id, popup, send };
  };
  try {
    let current = await launch(); receipt.browser = context.browser().version();
    assert.deepEqual(await current.send({ type: 'GET_WORDS' }), []);
    const checked = await current.popup.evaluate(async ({ words, version }) => {
      let checked = 0;
      for (const word of words) {
        const [english, chinese] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'GET_DEFINITION', word }), chrome.runtime.sendMessage({ type: 'GET_TRANSLATION', word }),
        ]);
        if (!english?.success || !chinese?.success || english.data.source !== 'rememberme-dict'
          || chinese.data.dictionary?.version !== version || english.data.translation?.dictionary?.version !== version) throw Error('Local lookup failed: ' + word);
        checked++;
      }
      return checked;
    }, { words: Object.keys(catalog.words), version: catalog.version });
    receipt.checked = checked; assert.equal(checked, 1000);
    let external = await current.worker.evaluate(() => globalThis.fixtureExternalRequests);
    assert.equal(external.filter(url => /\/lookup\/(dictionary|translation)/.test(url)).length, 0);
    assert.deepEqual(await current.send({ type: 'GET_WORDS' }), []);
    receipt.checks.push('All 1000 English and Chinese lookups hit approved local assets without online lookup calls or vocabulary writes.');
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    const cdp = await context.newCDPSession(page);
    const cardText = async () => {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const children = node => [...(node.children || []), ...(node.shadowRoots || [])];
      const collect = node => (node.nodeType === 3 ? node.nodeValue : '') + children(node).map(collect).join(' ');
      const find = node => (node.attributes || []).includes('vocab-counter-popup-root') ? collect(node) : children(node).map(find).find(Boolean);
      return find(root) || '';
    };
    await page.locator('#target').dblclick();
    const deadline = Date.now() + 15000;
    while (!/孩子们|剧院|钢琴|玩耍/.test(await cardText()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const text = await cardText(); assert.ok(!text.includes('Local dictionary')); assert.ok(!text.includes('Online translation'));
    assert.match(text, /孩子们|剧院|钢琴|玩耍/);
    await page.screenshot({ path: path.join(output, 'selection.png') });
    receipt.checks.push('Actual selection card shows bilingual examples without source footers inside the closed shadow root.');
    const definition = await current.send({ type: 'GET_DEFINITION', word: 'play' });
    await current.send({ type: 'SAVE_WORD', word: 'play', definition, context: 'Synthetic dictionary fixture only.', url: 'https://fixture.invalid/learner' });
    const exported = await current.send({ type: 'EXPORT_DATA' });
    assert.deepEqual(JSON.parse(exported)[0].history[0].definition, definition);
    await current.send({ type: 'RESET_COUNT', word: 'play' });
    const reset = JSON.parse(await current.send({ type: 'EXPORT_DATA' })); assert.equal(reset[0].count, 0); assert.equal(reset[0].history.length, 1);
    external = await current.worker.evaluate(() => globalThis.fixtureExternalRequests);
    receipt.externalLookupCalls = external.filter(url => /\/lookup\/(dictionary|translation)/.test(url)).length;
    receipt.otherExternalAttempts = external.filter(url => !/\/lookup\/(dictionary|translation)/.test(url));
    assert.equal(receipt.externalLookupCalls, 0);
    await context.close(); context = undefined; current = await launch();
    const reopened = JSON.parse(await current.send({ type: 'EXPORT_DATA' }));
    assert.equal(reopened[0].count, 0); assert.equal(reopened[0].history.length, 1);
    assert.deepEqual(reopened[0].history[0].definition, definition);
    receipt.checks.push('Synthetic save/export/reset/restart preserves publication metadata, bilingual examples and history.');
    await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally { await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(fixture, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
