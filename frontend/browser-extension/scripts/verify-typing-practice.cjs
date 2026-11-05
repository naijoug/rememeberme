// Real packaged extension, disposable profile and synthetic vocabulary only.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, rm, writeFile, cp, readFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = process.env.REMEMBERME_ACCEPTANCE_DIR || path.join(root, '.output/typing-acceptance');
const version = require('../package.json').version;
const archive = process.env.REMEMBERME_TYPING_ZIP || path.join(root, '.output', `remember-me-${version}-chrome.zip`);
const oldArchive = process.env.REMEMBERME_PREVIOUS_ZIP;
const words = [
  ['apple', 'A round fruit'], ["can't", 'Cannot'], ['well-known', 'Familiar to many people'],
].map(([word, meaning]) => ({ word, count: 3, createdAt: 1, updatedAt: 2,
  history: [{ timestamp: 2, context: 'Synthetic private context', url: 'https://fixture.invalid/private',
    definition: { word, phonetics: [], meanings: [{ partOfSpeech: 'fixture', definitions: [{ definition: meaning }] }] } }] }));

(async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-typing-browser-'));
  const profile = path.join(fixture, 'profile'), extension = path.join(fixture, 'extension');
  await mkdir(output, { recursive: true });
  let context, popup, practice, id;
  const requests = [], errors = [], checks = [];
  const unpack = async file => {
    const candidate = await mkdtemp(path.join(fixture, 'candidate-'));
    execFileSync('unzip', ['-q', file, '-d', candidate]);
    // Preserve the installed directory, matching the existing release-upgrade harness.
    // Only replace file contents while Chrome is closed; never recreate its installation root.
    await mkdir(extension, { recursive: true }); await cp(candidate, extension, { recursive: true, force: true });
  };
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1100, height: 850 },
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP rememberme-lookup.couplelabs.workers.dev ~NOTFOUND, MAP rememberme.couplelabs.cn ~NOTFOUND, MAP lookup.couplelabs.cn ~NOTFOUND'] });
    context.setDefaultTimeout(10000);
    context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).version,
      JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')).version);
    const currentId = new URL(worker.url()).hostname;
    if (id) assert.equal(currentId, id, 'Upgrade must retain the extension identity');
    id = currentId; popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  }
  const send = async (page, message) => {
    const reply = await page.evaluate(message => chrome.runtime.sendMessage(message), message);
    assert.ok(reply?.success, JSON.stringify(reply)); return reply.data;
  };
  async function click(page, name) { await page.bringToFront(); await page.getByRole('button', { name, exact: true }).click(); }
  async function active() {
    await practice.bringToFront();
    if (await practice.getByRole('button', { name: 'Resume practice', exact: true }).isVisible()) await click(practice, 'Resume practice');
    else if (await practice.getByRole('button', { name: 'Next word', exact: true }).isVisible()) await click(practice, 'Next word');
    await practice.getByLabel('Your spelling', { exact: true }).waitFor();
  }
  const get = () => send(practice, { type: 'PRACTICE_GET' });
  async function complete() {
    for (let n = 0; n < 35; n++) {
      let view = await get(); if (view.session.completed) return;
      await active(); view = await get();
      const current = view.session.current;
      const word = current.word || words.find(w => w.history[0].definition.meanings[0].definitions[0].definition === current.prompt)?.word;
      assert.ok(word, current.prompt);
      await practice.getByLabel('Your spelling', { exact: true }).fill(word);
      await click(practice, 'Check spelling');
      await practice.getByRole('heading', { name: /^(Correct|Round complete)$/ }).waitFor();
    }
    throw new Error('Practice did not terminate');
  }
  try {
    await unpack(oldArchive || archive); await launch();
    await send(popup, { type: 'IMPORT_DATA', jsonData: JSON.stringify(words) });
    const baseline = await send(popup, { type: 'EXPORT_DATA' });
    if (oldArchive) {
      await context.close(); context = undefined; await unpack(archive); await launch();
      const installer = await context.browser().newBrowserCDPSession();
      const installed = await installer.send('Extensions.loadUnpacked', { path: extension });
      assert.equal(installed.id, id); await installer.detach();
      popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
      assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline);
      checks.push('Same-identity 0.1.5 to 0.1.6 unpacked update via Chromium installer preserves synthetic vocabulary');
    }
    // Even granted consent must not make the practice page call explanation APIs.
    await popup.evaluate(() => chrome.storage.local.set({ contextExplanationConsent: { version: 1, enabled: true } }));
    const pageEvent = context.waitForEvent('page'); await click(popup, 'Typing practice'); practice = await pageEvent;
    await practice.waitForURL(`chrome-extension://${id}/practice.html`);
    await practice.getByText('3 available', { exact: false }).waitFor();
    await context.setOffline(true);
    await click(practice, 'Start a new round'); await active();
    assert.equal((await get()).session.current.word, undefined);
    assert.equal(await practice.locator('.practice-letters').count(), 0);
    const imeEnterCancelled = await practice.getByLabel('Your spelling', { exact: true }).evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(imeEnterCancelled, false);
    assert.equal(await practice.getByRole('button', { name: 'Check spelling', exact: true }).isDisabled(), true);
    await practice.getByLabel('Your spelling', { exact: true }).dispatchEvent('compositionend');
    checks.push('Synthetic IME composition in Chrome preserves Enter default behavior and disables answer submission');
    await practice.screenshot({ path: path.join(output, 'spelling.png'), fullPage: true });
    await practice.getByLabel('Your spelling', { exact: true }).fill('wrong'); await click(practice, 'Check spelling');
    await practice.getByRole('heading', { name: 'Keep practicing', exact: true }).waitFor();
    await active(); await click(practice, 'Show answer'); await practice.locator('.practice-letters').waitFor();
    await practice.reload(); await active();
    assert.equal((await get()).session.current.hinted, true);
    assert.equal((await get()).session.current.interrupted, true);
    await complete();
    assert.ok((await get()).session.summary.retries >= 2);
    assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline);
    checks.push('Offline spelling, hidden answers, wrong-word retries, persisted hints and refresh recovery preserve vocabulary');
    await practice.getByRole('combobox').selectOption('copy'); await click(practice, 'Start a new round'); await active();
    await practice.getByLabel('Your spelling', { exact: true }).fill('partial'); await practice.reload();
    await active(); assert.equal((await get()).session.current.interrupted, true);
    await click(practice, 'Pause'); await practice.getByRole('heading', { name: 'Ready when you are' }).waitFor();
    await active();
    await practice.screenshot({ path: path.join(output, 'copy.png'), fullPage: true });
    await practice.evaluate(() => chrome.storage.local.set({ appearance: 'dark' }));
    await practice.locator('[data-theme="dark"]').waitFor();
    await practice.setViewportSize({ width: 360, height: 800 });
    assert.ok(await practice.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await practice.screenshot({ path: path.join(output, 'narrow-dark.png'), fullPage: true });
    await practice.evaluate(() => chrome.storage.local.set({ appearance: 'light' }));
    await practice.setViewportSize({ width: 1100, height: 850 });
    checks.push('Dark theme and 360px layout without horizontal overflow');
    const other = await context.newPage(); await other.goto(practice.url()); await click(other, 'Resume practice');
    await practice.getByRole('heading', { name: 'Ready when you are' }).waitFor();
    await other.close(); await active();
    checks.push('Copy mode, pause, interruption and second-tab session coordination');
    const savedId = (await get()).session.id;
    await context.close(); context = undefined; await launch();
    practice = await context.newPage(); await practice.goto(`chrome-extension://${id}/practice.html`); await active();
    assert.equal((await get()).session.id, savedId); assert.equal((await get()).session.current.interrupted, true);
    await complete(); assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline);
    checks.push('Chrome process restart retains the practice session and marks the unfinished attempt interrupted');
    await practice.screenshot({ path: path.join(output, 'results.png'), fullPage: true });
    await practice.getByRole('combobox').selectOption('copy'); await click(practice, 'Start a new round'); await active();
    const currentWord = (await get()).session.current.word;
    const entries = await send(popup, { type: 'GET_WORDS' }); const entry = entries.find(e => e.word === currentWord);
    const unrelated = entries.find(e => e.word !== currentWord);
    await practice.getByLabel('Your spelling', { exact: true }).fill('partial');
    await send(popup, { type: 'DELETE_WORD', word: unrelated.id });
    await practice.getByText('1 changed or removed words', { exact: false }).waitFor();
    assert.equal(await practice.getByLabel('Your spelling', { exact: true }).inputValue(), 'partial');
    assert.equal((await get()).session.current.interrupted, false);
    checks.push('Deleting a different question preserves the current input and uninterrupted attempt');
    await send(popup, { type: 'DELETE_WORD', word: entry.id });
    await practice.getByText('2 changed or removed words', { exact: false }).waitFor();
    assert.equal((await get()).session.summary.total, 1);
    checks.push('Local deletion invalidates an open question and cleans its practice references');
    await click(popup, 'Settings'); await click(popup, 'Clear practice records'); await click(popup, 'Cancel');
    assert.ok((await get()).session);
    await click(popup, 'Clear practice records'); await click(popup, 'Clear records');
    await popup.getByText('Practice records cleared for the current vocabulary.', { exact: true }).waitFor();
    assert.equal((await get()).session, null);
    assert.equal((await send(popup, { type: 'GET_WORDS' })).length, 1);
    checks.push('Settings clear confirmation preserves vocabulary; cancellation preserves the session');
    await practice.locator('.practice-card').waitFor({ state: 'hidden' });
    await practice.bringToFront(); await click(practice, 'Start a new round'); await active();
    await practice.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('rememberme-vocabulary-v2', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('partitions', 'readwrite'), store = tx.objectStore('partitions');
        const read = store.get('practice:v1:anonymous');
        read.onsuccess = () => { const value = read.result; value.session.words[0] = null; store.put(value, 'practice:v1:anonymous'); };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }));
    await practice.reload(); await practice.getByText('Practice progress is damaged.', { exact: false }).waitFor();
    await click(practice, 'Clear practice records'); await click(practice, 'Cancel'); assert.equal((await get()).corrupt, true);
    await click(practice, 'Clear practice records'); await click(practice, 'Clear records');
    await practice.getByText('Practice progress is damaged.', { exact: false }).waitFor({ state: 'hidden' });
    assert.equal((await get()).session, null); assert.equal((await send(popup, { type: 'GET_WORDS' })).length, 1);
    checks.push('Damaged nested practice data offers confirmed repair without deleting vocabulary');
    assert.deepEqual(requests, [], 'Practice must not send lookup/account/explanation requests');
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ version, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), browser: context.browser().version(), checks, requests, errors,
      limitations: ['Disposable Chrome for Testing profile; no real user vocabulary.', 'Account/remote-sync cases use automated injected tests, not live hosted accounts.', 'Physical IME and assistive-technology behavior were not manually verified.'] }, null, 2) + '\n');
    console.log(JSON.stringify({ version, checks, requests, errors, output }, null, 2));
  } catch (error) {
    console.error('Browser diagnostics:', JSON.stringify({ errors, requests,
      text: await practice?.locator('body').innerText().catch(() => ''),
      view: await practice?.evaluate(() => chrome.runtime.sendMessage({ type: 'PRACTICE_GET' })).catch(e => String(e)) }));
    await practice?.screenshot({ path: path.join(os.tmpdir(), 'rememberme-typing-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context?.close(); await rm(fixture, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
