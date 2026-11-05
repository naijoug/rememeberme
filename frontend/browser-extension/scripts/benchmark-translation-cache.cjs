// Explicit browser/live-provider diagnostic; only disposable profiles and fixture words.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
const [extensionArg, outputArg, live] = process.argv.slice(2);
if (!extensionArg || !outputArg || live !== '--live') throw new Error('Usage: node benchmark-translation-cache.cjs EXTENSION_DIRECTORY REPORT_JSON --live');
(async () => {
  const extension = path.resolve(extensionArg), output = path.resolve(outputArg);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rememberme-cache-browser-'));
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Cache benchmark fixture</title><style>body{font:28px Georgia;padding:100px}#word{display:inline-block}</style><p>A <span id="word">harbor</span> appears here.</p>'); });
  let context;
  const report = { kind: 'real-extension-live-provider', extension, samples: [], limitations: ['Disposable Chrome, not the user profile.', 'First means an empty client cache; upstream cache state is unknown.', 'DOM polling resolution is approximately 20 ms; not a p95 benchmark.'] };
  async function launch() {
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { headless: true, channel: 'chromium', viewport: { width: 1100, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    report.browser = context.browser().version();
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.benchmark = { requests: [], saves: 0 };
      chrome.runtime.onMessage.addListener(message => { if (message?.type === 'SAVE_WORD') benchmark.saves++; });
      const original = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).endsWith('/api/v1/public/lookup/translation')) return original(url, init);
        const row = { word: JSON.parse(init.body).word, startedAt: performance.now() }; benchmark.requests.push(row);
        if (benchmark.hold === row.word) return new Promise(resolve => { benchmark.release = () => { row.status = 200; resolve(new Response(JSON.stringify({ translation: { text: '刷新后的港口', source: 'magpie', target: 'zh-CN' } }), { headers: { 'Content-Type': 'application/json' } })); }; });
        try { const response = await original(url, init); row.status = response.status; row.ms = performance.now() - row.startedAt; void response.clone().json().then(data => { row.source = data.translation?.source; }).catch(() => {}); return response; }
        catch (error) { row.error = error.name; row.ms = performance.now() - row.startedAt; throw error; }
      };
    });
    const page = await context.newPage();
    await page.addInitScript(() => document.addEventListener('mouseup', () => { window.benchmarkStarted = performance.now(); }, true));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const cdp = await context.newCDPSession(page);
    const children = node => [...(node.children || []), ...(node.shadowRoots || [])];
    const attr = (node, name) => { const i = (node.attributes || []).indexOf(name); return i < 0 ? '' : node.attributes[i + 1]; };
    const find = (node, predicate) => { if (predicate(node)) return node; for (const child of children(node)) { const result = find(child, predicate); if (result) return result; } };
    async function measure(word, scenario) {
      await page.keyboard.press('Escape');
      await page.locator('#word').evaluate((node, word) => { node.textContent = word; window.getSelection().removeAllRanges(); }, word);
      const before = await worker.evaluate(() => benchmark.requests.length);
      await page.locator('#word').dblclick();
      let cardMs;
      for (let i = 0; i < 1100; i++) {
        const root = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
        const card = find(root, node => attr(node, 'role') === 'dialog');
        if (card && cardMs === undefined) cardMs = await page.evaluate(() => performance.now() - window.benchmarkStarted);
        const translation = card && find(card, node => attr(node, 'class').split(' ').includes('translation-text'));
        if (translation) {
          const ms = await page.evaluate(() => performance.now() - window.benchmarkStarted);
          const text = (translation.children || []).map(node => node.nodeValue || '').join('');
          if (/[\u3400-\u9fff]/u.test(text)) {
            const requests = await worker.evaluate(start => benchmark.requests.slice(start), before);
            const sample = { word, scenario, popupMs: Math.round(cardMs), chineseMs: Math.round(ms), httpRequests: requests.length, requests };
            if (scenario === 'stale-preview') { assert.equal(requests.length, 1); assert.equal(text, '缓存港口'); }
            else if (scenario !== 'first-client-lookup') assert.equal(requests.length, 0, 'Repeated lookup must avoid HTTP');
            report.samples.push(sample); console.log(JSON.stringify(sample)); return;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Translation did not appear for fixture ' + word);
    }
    return { worker, measure };
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let session = await launch();
    for (const word of ['harbor', 'orchard', 'copper']) {
      await session.measure(word, 'first-client-lookup');
      await session.measure(word, 'repeat-client-lookup');
    }
    assert.equal(await session.worker.evaluate(() => benchmark.saves), 0);
    await new Promise(resolve => setTimeout(resolve, 500));
    await context.close(); context = undefined;
    session = await launch();
    await session.measure('copper', 'restart-client-lookup');
    assert.equal(await session.worker.evaluate(() => benchmark.saves), 0);
    if (await session.worker.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'rememberme-translation-cache-v1'))) {
      await session.worker.evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('rememberme-translation-cache-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
          const key = JSON.stringify(['https://rememberme-lookup.couplelabs.workers.dev', 'public:v3', 'zh-CN', 'harbor']);
          const request = store.get(key); request.onsuccess = () => { const row = request.result; if (!row) { tx.abort(); return; } row.timestamp = Date.now() - 8 * 86400000; row.translation.text = '缓存港口'; store.put(row); };
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); db.close(); benchmark.hold = 'harbor';
      });
      await session.measure('harbor', 'stale-preview');
      await session.worker.evaluate(() => benchmark.release());
      report.stalePreview = 'Synthetic expired cache appeared while a held synthetic refresh was still pending; other timing samples used the live provider.';
    }
    report.noVocabularySaves = true;
    await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  } finally { await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
