// Real old-ZIP -> new-ZIP upgrade in one disposable profile and installation path.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, readFile, writeFile, cp, rm } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const previousZip = process.env.REMEMBERME_PREVIOUS_ZIP;
  assert.ok(previousZip, 'Set REMEMBERME_PREVIOUS_ZIP to the accepted 0.1.0 ZIP.');
  const archive = path.join(root, `.output/remember-me-${version}-chrome.zip`);
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-real-upgrade-'));
  const profile = path.join(fixture, 'profile'), installed = path.join(fixture, 'installed'), candidate = path.join(fixture, 'candidate');
  await mkdir(installed); await mkdir(candidate);
  let context;
  const checks = [], failures = [], localhost = [];
  const words = [{ word: 'upgradefixture', count: 0.5, createdAt: 1, updatedAt: 2,
    history: [{ timestamp: 2, context: '<b>upgradefixture</b> remains literal', url: 'https://example.test/upgrade?fixture=1#retained', definition: { word: 'upgradefixture', phonetics: [], meanings: [] } }] }];
  const launch = async (headless = true) => {
    context = await chromium.launchPersistentContext(profile, { headless, channel: 'chromium', viewport: { width: 400, height: 600 }, args: [`--disable-extensions-except=${installed}`, `--load-extension=${installed}`] });
    context.setDefaultTimeout(15000);
    context.on('request', request => { if (/https?:\/\/(?:localhost|127\.0\.0\.1):3937\//.test(request.url())) localhost.push(request.url()); });
    context.on('requestfailed', request => { if (request.url().startsWith('chrome-extension:')) failures.push(request.failure()?.errorText); });
    return context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  };
  const openPopup = async id => { const page = await context.newPage(); await page.goto(`chrome-extension://${id}/popup.html`); await page.getByRole('heading', { name: 'Remember Me', exact: true }).waitFor(); return page; };
  const exported = async page => { const reply = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EXPORT_DATA' })); assert.equal(reply.success, true); return JSON.parse(reply.data); };
  try {
    execFileSync('unzip', ['-q', previousZip, '-d', installed]);
    const worker = await launch(), id = new URL(worker.url()).hostname;
    const oldManifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(oldManifest.version, '0.1.0');
    const old = await openPopup(id);
    const imported = await old.evaluate(jsonData => chrome.runtime.sendMessage({ type: 'IMPORT_DATA', jsonData }), JSON.stringify(words));
    assert.equal(imported.success, true); assert.deepEqual(await exported(old), words);
    await context.close(); context = undefined;
    execFileSync('unzip', ['-q', archive, '-d', candidate]);
    // Closed-browser replacement models a completed installer update. No live
    // installation directory or user profile is deleted/recreated by a build.
    await cp(candidate, installed, { recursive: true, force: true });
    const updatedWorker = await launch();
    assert.equal(new URL(updatedWorker.url()).hostname, id);
    assert.equal((await updatedWorker.evaluate(() => chrome.runtime.getManifest())).version, version);
    const updated = await openPopup(id); await updated.locator('.word-header').waitFor();
    assert.deepEqual(await exported(updated), words);
    checks.push('Actual 0.1.0 ZIP -> new ZIP update retained the same extension ID/profile, fractional count, literal context and full source URL.');
    await context.setOffline(true);
    for (let i = 0; i < 3; i++) {
      const popup = await openPopup(id); await popup.locator('.word-header').waitFor();
      assert.deepEqual(await exported(popup), words);
      assert.equal(await popup.locator('[aria-label="HTTPS API address"]').count(), 0);
      await popup.close();
    }
    checks.push('Three popup reopenings with all network offline succeeded using packaged HTML/JS/CSS and local vocabulary.');
    await context.setOffline(false);
    const stalled = await context.newPage();
    await stalled.addInitScript(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => args[0]?.type === 'GET_WORDS' ? new Promise(() => {}) : original(...args);
    });
    await stalled.goto(`chrome-extension://${id}/popup.html`);
    await stalled.getByRole('alert').filter({ hasText: 'extension is restarting' }).waitFor({ timeout: 15000 });
    await stalled.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await stalled.close();
    const recovered = await openPopup(id); await recovered.locator('.word-header').waitFor(); assert.deepEqual(await exported(recovered), words);
    checks.push('A controlled stalled GET_WORDS transport in the real packaged popup produced a bounded retry error; a new genuine popup recovered with unchanged vocabulary.');
    await context.close(); context = undefined;
    const restartedWorker = await launch(false);
    await context.setOffline(true);
    const restarted = await openPopup(id); await restarted.locator('.word-header').waitFor();
    assert.deepEqual(await exported(restarted), words);
    const debuggerSession = await context.browser().newBrowserCDPSession();
    const existingTargets = new Set((await debuggerSession.send('Target.getTargets')).targetInfos.map(target => target.targetId));
    await restartedWorker.evaluate(() => chrome.action.openPopup());
    // Action popup targets are not consistently surfaced as Playwright pages.
    const targets = (await debuggerSession.send('Target.getTargets')).targetInfos;
    const popupTarget = targets.find(target => target.url === `chrome-extension://${id}/popup.html` && !existingTargets.has(target.targetId));
    assert.ok(popupTarget, 'Chrome action popup target was not opened: ' + JSON.stringify(targets.map(({ type, url }) => ({ type, url }))));
    const { sessionId } = await debuggerSession.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
    let commandId = 0;
    const command = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++commandId;
      const timer = setTimeout(() => { debuggerSession.off('Target.receivedMessageFromTarget', onMessage); reject(new Error('Action-popup CDP command timed out')); }, 10000);
      const onMessage = event => {
        if (event.sessionId !== sessionId) return;
        const value = JSON.parse(event.message); if (value.id !== requestId) return;
        clearTimeout(timer); debuggerSession.off('Target.receivedMessageFromTarget', onMessage);
        if (value.error) reject(new Error(value.error.message)); else resolve(value.result);
      };
      debuggerSession.on('Target.receivedMessageFromTarget', onMessage);
      debuggerSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch(reject);
    });
    const actionState = await command('Runtime.evaluate', { expression: '(async () => { const end=Date.now()+10000; while(!document.querySelector(".word-header") && Date.now()<end) await new Promise(resolve=>setTimeout(resolve,50)); const data = await chrome.runtime.sendMessage({type:"EXPORT_DATA"}); return {data, title:document.title, loaded:!!document.querySelector(".word-header")}; })()', awaitPromise: true, returnByValue: true });
    assert.equal(actionState.result.value.title, 'Remember Me');
    assert.equal(actionState.result.value.loaded, true);
    assert.deepEqual(JSON.parse(actionState.result.value.data.data), words);
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(root, 'docs/release/assets/upgrade-toolbar.png'), Buffer.from(screenshot.data, 'base64'));
    await debuggerSession.detach();
    checks.push('Chrome action.openPopup opened the real browser action popup offline after update/restart; packaged UI and retained vocabulary rendered.');
    assert.deepEqual(failures, []); assert.deepEqual(localhost, []);
    const result = { version, previousVersion: oldManifest.version, extensionId: id, browser: context.browser().version(), archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), checks: [...checks, 'Process restart offline retained vocabulary; no extension-file request failures or localhost dependency were observed.'], limits: ['Completed replacement while the test browser is closed; Chrome Web Store signing/update delivery is external.', 'The stalled-read case deliberately substitutes a test transport; it does not claim a real backend outage.'] };
    await writeFile(path.join(root, 'docs/release/assets/upgrade-acceptance.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await context?.close(); await rm(fixture, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
