// Optional installed-extension smoke check. Uses an existing Playwright install;
// see docs/release/README.md. Never connects to the user's browser profile.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'docs/release/assets');
const article = `<!doctype html><html lang="en"><meta charset="utf-8"><title>A pleasant discovery — reading example</title><style>
body{margin:0;background:#f7f6f2;color:#273343;font-family:Georgia,serif}main{max-width:760px;margin:95px auto}small{font:13px system-ui;letter-spacing:2px;color:#526c91}h1{font-size:46px;line-height:1.2;margin:28px 0}p{font-size:24px;line-height:1.9}footer{margin-top:260px;color:#6a737e;font:14px system-ui}
</style><main><small>READING NOTES · AN EXAMPLE</small><h1>A pleasant discovery</h1><p>Sometimes a quiet afternoon brings a little <span id="target">serendipity</span>.</p><p>You open a book, find a new idea, and see a familiar place in a different way.</p><footer>Example text for Remember Me · Select a word to explore its meaning.</footer></main></html>`;

(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'rememberme-release-'));
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(article); });
  let context;
  const results = { checks: [], limitations: ['Online dictionary requests are blocked; this verifies packaged definitions, not the live API.', 'Native context menu, toolbar popup anchoring, upgrade behavior and Firefox runtime are not tested.'] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/reading-example`;
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${path.join(root, '.output/chrome-mv3')}`, `--load-extension=${path.join(root, '.output/chrome-mv3')}`],
    });
    context.setDefaultTimeout(10000);
    await context.route('https://api.mymemory.translated.net/get*', route => route.abort('internetdisconnected'));
    let dictionaryRequests = 0;
    await context.route('https://api.dictionaryapi.dev/api/v2/entries/en/*', async route => {
      dictionaryRequests++;
      await route.abort('internetdisconnected');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.version, '0.1.0');
    assert.deepEqual(manifest.permissions, ['storage', 'contextMenus']);
    results.browser = await context.browser().version();
    results.checks.push('Production extension loaded with storage/contextMenus permissions; no activeTab.');
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#target').dblclick();
    await page.locator('.vocab-counter-popup .definition-text').waitFor();
    assert.equal(dictionaryRequests, 0, 'a packaged word must not contact the online dictionary');
    assert.match(await page.locator('.definition-source').innerText(), /Offline dictionary.*WordNet/);
    await mkdir(assets, { recursive: true });
    await page.screenshot({ path: path.join(assets, 'screenshot-selection.png') });
    await page.getByRole('button', { name: 'Remember', exact: true }).click();
    const getWords = () => worker.evaluate(async () => (await chrome.storage.local.get('words')).words || []);
    assert.deepEqual(await getWords(), []);
    results.checks.push('Selected word loads a packaged WordNet definition without an online request; Remember does not save.');
    for (let i = 0; i < 2; i++) {
      await page.locator('#target').dblclick();
      await page.locator('.vocab-counter-popup .definition-text').waitFor();
      await page.getByRole('button', { name: 'Forget', exact: true }).click();
      await page.locator('.vocab-counter-popup').waitFor({ state: 'hidden' });
    }
    let saved = await getWords();
    assert.equal(saved[0].count, 2);
    assert.equal(saved[0].history.length, 2);
    assert.equal(saved[0].history[0].url, url);
    assert.match(saved[0].history[0].context, /serendipity/);
    results.checks.push('Two Forget saves persist count 2, two histories, context and full fixture URL.');
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('heading', { name: 'Remember Me', exact: true }).waitFor();
    await popup.locator('.word-header').click();
    await popup.getByRole('button', { name: 'Reset count', exact: true }).click();
    await popup.getByText('Forgotten 0 times', { exact: true }).waitFor();
    saved = await getWords();
    assert.equal(saved[0].count, 0);
    assert.equal(saved[0].history.length, 2);
    results.checks.push('Popup reset preserves history while setting count to zero.');
    // The redesigned reading view stays open after reset.
    await popup.getByRole('button', { name: 'Delete', exact: true }).click();
    await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await getWords()).length, 1);
    const downloadPromise = popup.waitForEvent('download');
    await popup.getByRole('button', { name: 'More options', exact: true }).click();
    await popup.getByRole('menuitem', { name: 'Export vocabulary', exact: true }).click();
    const download = await downloadPromise;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(backup, await getWords());
    await popup.getByRole('button', { name: 'Delete', exact: true }).click();
    await popup.locator('.confirm-btn').click();
    await popup.locator('.empty').waitFor();
    assert.deepEqual(await getWords(), []);
    results.checks.push('Cancel preserves the word; confirmed deletion removes it; exported JSON matches storage.');
    await popup.locator('input[type=file]').setInputFiles({ name: 'fixture-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await popup.getByText('Data imported successfully!', { exact: true }).waitFor();
    assert.deepEqual(await getWords(), backup);
    await popup.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await popup.locator('.error').waitFor();
    assert.deepEqual(await getWords(), backup);
    results.checks.push('Import restores count/history independently; malformed JSON preserves vocabulary.');
    await popup.reload();
    await popup.locator('.word-header').click();
    await popup.screenshot({ path: path.join(assets, 'popup-verification.png') });
    results.checks.push('Captured 1280x800 actual content-card screenshot and 400x600 popup verification image.');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
