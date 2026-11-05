// Disposable Chrome checks for website controls and popup geometry. No real vocabulary/accounts.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = process.env.REMEMBERME_ACCEPTANCE_DIR || path.join(root, '.output/reading-controls-acceptance');
(async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-reading-controls-'));
  const profile = path.join(fixture, 'profile');
  const extension = path.join(root, '.output/chrome-mv3');
  await mkdir(output, { recursive: true });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><head><title>Reading controls fixture</title><style>body{margin:0;background:#faf9f6;font:22px Georgia;color:#243029}main{padding:80px 35px;max-width:680px}p{line-height:1.8}.scroll{height:200px;overflow:auto}.inner{height:500px}</style></head><body><main><h1>Reading controls fixture</h1><p>A fresh <span id="target">apple</span> on a quiet morning.</p><div class="scroll"><div class="inner"><p>A second <span id="second">banana</span> inside a scrollable paragraph.</p></div></div></main></body></html>');
  });
  let context;
  const results = { checks: [], limitations: ['Disposable extension popup tab, not native toolbar anchoring.', 'No live provider requests, account synchronization, real vocabulary or native browser context-menu click.', 'Browser zoom is tested via tabs.setZoom; mobile pinch is not a physical-device test.'] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/fixture`;
    const launch = () => chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1000, height: 800 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP lookup.couplelabs.cn ~NOTFOUND, MAP rememberme-lookup.couplelabs.workers.dev ~NOTFOUND, MAP rememberme.couplelabs.cn ~NOTFOUND'] });
    context = await launch(); context.setDefaultTimeout(10000);
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname; results.browser = context.browser().version();
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ translationCache: Object.fromEntries(['apple', 'banana'].map(word => ['public:v3:' + word, { text: '离线测试释义', source: 'magpie', timestamp: Date.now() }])) });
    });
    let page = await context.newPage(); await page.goto(url);
    let cdp = await context.newCDPSession(page);
    async function card() {
      const { root: tree } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      function find(node) {
        const attrs = Object.fromEntries((node.attributes || []).reduce((a, v, i, all) => { if (i % 2 === 0) a.push([v, all[i + 1]]); return a; }, []));
        if (attrs.role === 'dialog' && (attrs.class || '').includes('vocab-counter-popup')) return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const match = find(child); if (match) return match; }
      }
      return find(tree);
    }
    async function poll(check, label) {
      for (let n = 0; n < 100; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw new Error('Timed out: ' + label);
    }
    async function select(selector = '#target') {
      await page.keyboard.press('Escape');
      await page.locator(selector).dblclick();
      await poll(card, 'selection card');
    }
    async function tabID() { return worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url()); }
    async function fits() {
      const node = await card(); assert.ok(node);
      const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
      const q = model.border;
      const bounds = await page.evaluate(() => ({ left: visualViewport.offsetLeft, top: visualViewport.offsetTop,
        right: visualViewport.offsetLeft + visualViewport.width, bottom: visualViewport.offsetTop + visualViewport.height }));
      assert.ok(Math.min(q[0], q[2], q[4], q[6]) >= bounds.left - 1, JSON.stringify({ q, bounds }));
      assert.ok(Math.max(q[0], q[2], q[4], q[6]) <= bounds.right + 1, JSON.stringify({ q, bounds }));
      assert.ok(Math.min(q[1], q[3], q[5], q[7]) >= bounds.top - 1, JSON.stringify({ q, bounds }));
      assert.ok(Math.max(q[1], q[3], q[5], q[7]) <= bounds.bottom + 1, JSON.stringify({ q, bounds }));
    }
    await select(); await fits();
    const articleID = await tabID();
    for (const zoom of [0.8, 1, 1.25, 2]) {
      await worker.evaluate(async ({ tab, zoom }) => chrome.tabs.setZoom(tab, zoom), { tab: articleID, zoom });
      await select(); await fits();
    }
    await worker.evaluate(async tab => chrome.tabs.setZoom(tab, 1), articleID);
    await page.setViewportSize({ width: 360, height: 640 }); await select(); await fits();
    await page.screenshot({ path: path.join(output, 'narrow-selection.png') });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.evaluate(() => { document.body.style.transform = 'translate(24px, 18px) scale(0.8)'; document.body.style.transformOrigin = 'top left'; });
    await select(); await fits();
    await page.evaluate(() => { document.body.style.transform = ''; });
    await select('#second');
    await page.locator('.scroll').evaluate(element => { element.scrollTop = 100; });
    await poll(card, 'card survives nested scroll'); await fits();
    results.checks.push('80/100/125/200 percent browser zoom, narrow viewport, transformed body and nested scrolling');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await worker.evaluate(tab => chrome.tabs.update(tab, { active: true }), articleID);
    await popup.evaluate(() => document.querySelector('[aria-label="Settings"]').click());
    await popup.getByText('Disable on this website', { exact: true }).waitFor();
    await popup.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Disable on this website').click());
    await popup.getByText('Enable on this website', { exact: true }).waitFor();
    await poll(async () => !(await card()), 'disabled card closes');
    await page.locator('#target').dblclick(); await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(await card(), undefined);
    await page.reload(); await page.locator('#target').dblclick(); await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(await card(), undefined);
    await popup.screenshot({ path: path.join(output, 'website-settings.png') });
    // Same server, different exact hostname remains enabled.
    const other = await context.newPage(); await other.goto(`http://localhost:${port}/fixture`);
    page = other; cdp = await context.newCDPSession(page); await select(); await fits();
    results.checks.push('Settings UI disables the active exact hostname immediately and across page reload; another hostname stays enabled');
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const stored = await worker.evaluate(() => chrome.storage.local.get('siteSettings'));
    assert.deepEqual(stored.siteSettings, { schemaVersion: 1, disabledHosts: ['127.0.0.1'] });
    page = await context.newPage(); await page.goto(url); cdp = await context.newCDPSession(page);
    await page.locator('#target').dblclick(); await new Promise(resolve => setTimeout(resolve, 600)); assert.equal(await card(), undefined);
    const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/popup.html`);
    await settings.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Enable 127.0.0.1', exact: true }).click();
    await select(); await fits();
    const words = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_WORDS' }));
    assert.equal(words.success, true); assert.deepEqual(words.data, []);
    results.checks.push('Process restart retains the rule; saved-host Enable restores lookup; vocabulary stays empty');
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
