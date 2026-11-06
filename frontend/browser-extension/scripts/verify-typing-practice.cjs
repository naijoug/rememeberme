// Packaged typing-flow verification. Disposable profile and synthetic vocabulary only.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, rm, writeFile, cp, readFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = process.env.REMEMBERME_ACCEPTANCE_DIR || path.join(root, '.output/typing-flow-acceptance');
const archive = process.env.REMEMBERME_TYPING_ZIP || path.join(root, '.output', `remember-me-${version}-chrome.zip`);
const oldArchive = process.env.REMEMBERME_PREVIOUS_ZIP;
const word = (name, meaning) => ({ word: name, count: 3, createdAt: 1, updatedAt: 2, history: [{ timestamp: 2,
  context: 'Synthetic context', url: 'https://fixture.invalid/private', definition: { word: name, phonetics: [],
    meanings: [{ partOfSpeech: 'fixture', definitions: [{ definition: meaning }] }] } }] });
const words = [word('cancel', 'To stop or withdraw an action'), word("can't", 'Cannot'), word('well-known', 'Familiar to many people')];
(async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rememberme-typing-flow-'));
  const profile = path.join(fixture, 'profile'), extension = path.join(fixture, 'extension');
  await mkdir(output, { recursive: true });
  let context, popup, practice, id;
  const requests = [], errors = [], checks = [], diagnostics = [];
  const unpack = async file => {
    const candidate = await mkdtemp(path.join(fixture, 'candidate-'));
    execFileSync('unzip', ['-q', file, '-d', candidate]);
    await mkdir(extension, { recursive: true }); await cp(candidate, extension, { recursive: true, force: true });
  };
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1280, height: 800 },
      args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--host-resolver-rules=MAP rememberme-lookup.couplelabs.workers.dev ~NOTFOUND, MAP rememberme.couplelabs.cn ~NOTFOUND, MAP lookup.couplelabs.cn ~NOTFOUND'] });
    context.setDefaultTimeout(10000);
    context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    context.on('page', p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) diagnostics.push(m.text()); }); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const currentId = new URL(worker.url()).hostname; if (id) assert.equal(currentId, id); id = currentId;
    popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  }
  const send = async (page, message) => {
    const reply = await page.evaluate(m => chrome.runtime.sendMessage(m), message);
    assert.ok(reply?.success, JSON.stringify(reply)); return reply.data;
  };
  const get = () => send(practice, { type: 'PRACTICE_GET' });
  async function click(page, label) { await page.bringToFront(); await page.getByRole('button', { name: label, exact: true }).click(); }
  async function poll(check, name) { for (let n = 0; n < 120; n++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out: ' + name); }
  const input = () => practice.getByLabel('Your spelling', { exact: true });
  async function ready() { await practice.bringToFront(); await poll(() => input().isEnabled(), 'active typing input'); }
  async function resume() { await click(practice, 'Resume'); await ready(); }
  async function finishCopy() {
    for (let n = 0; n < 35; n++) {
      const v = await get(); if (v.session.completed) return;
      if (!await input().isEnabled()) await resume();
      const current = (await get()).session.current;
      await input().fill(''); await input().pressSequentially(current.word);
      await poll(async () => { const next = await get(); return next.session.completed || next.session.current.turnId !== current.turnId; }, 'automatic next word');
    }
    throw new Error('Round did not terminate');
  }
  async function openSettingsClear(confirm = true) {
    await click(practice, 'Practice settings'); await click(practice, 'Clear practice records');
    await click(practice, confirm ? 'Clear records' : 'Cancel');
  }
  try {
    await unpack(oldArchive || archive); await launch();
    await send(popup, { type: 'IMPORT_DATA', jsonData: JSON.stringify([words[0]]) });
    let baseline = await send(popup, { type: 'EXPORT_DATA' });
    if (oldArchive) {
      await context.close(); context = undefined; await unpack(archive); await launch();
      const installer = await context.browser().newBrowserCDPSession();
      const installed = await installer.send('Extensions.loadUnpacked', { path: extension }); assert.equal(installed.id, id); await installer.detach();
      popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
      assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline); checks.push('Same-identity upgrade preserves synthetic vocabulary');
    }
    await popup.evaluate(() => chrome.storage.local.set({ appearance: 'dark', contextExplanationConsent: { version: 1, enabled: true },
      translationCache: { 'public:v3:cancel': { text: '取消，撤销；删去', source: 'magpie', timestamp: Date.now() } } }));
    const config = await readFile(path.join(root, 'config/backend.ts'), 'utf8');
    const lookupOrigin = config.match(/LOOKUP_SERVICE_ORIGIN\s*=\s*'([^']+)'/)[1];
    await popup.evaluate(origin => new Promise((resolve, reject) => {
      const open = indexedDB.open('rememberme-translation-cache-v1', 1);
      open.onupgradeneeded = () => { const entries = open.result.createObjectStore('entries', { keyPath: 'key' }); entries.createIndex('lastUsed', 'lastUsed'); entries.createIndex('timestamp', 'timestamp'); open.result.createObjectStore('metadata'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['entries', 'metadata'], 'readwrite');
        tx.objectStore('entries').put({ key: JSON.stringify([origin, 'public:v3', 'zh-CN', 'cancel']), word: 'cancel', format: 1,
          translation: { text: '取消，撤销；删去', source: 'magpie', target: 'zh-CN' }, timestamp: Date.now(), lastUsed: Date.now() });
        tx.objectStore('metadata').put(true, 'legacy-public-v3');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }), lookupOrigin);
    const newPage = context.waitForEvent('page'); await click(popup, 'Typing practice'); practice = await newPage;
    await practice.waitForURL(`chrome-extension://${id}/practice.html`);
    await practice.getByRole('heading', { name: 'Ready to type?' }).waitFor();
    assert.equal(await practice.getByRole('button', { name: 'Copy', exact: true }).getAttribute('aria-pressed'), 'true');
    await practice.bringToFront(); await practice.keyboard.press('Enter'); await ready();
    await practice.locator('.practice-meaning').filter({ hasText: '取消，撤销；删去' }).waitFor();
    await practice.locator('.practice-ipa').filter({ hasText: 'AmE:' }).waitFor();
    assert.equal(await input().evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(await practice.getByRole('button', { name: 'Check spelling', exact: true }).count(), 0);
    assert.equal(await practice.getByRole('button', { name: 'Next word', exact: true }).count(), 0);
    await input().pressSequentially('ca'); assert.equal(await practice.locator('.letter-correct').count(), 2);
    await poll(() => practice.locator('.letter-correct').evaluateAll(letters => letters.every(el => getComputedStyle(el).color === 'rgb(120, 201, 151)')), 'settled correct-letter colors');
    await practice.screenshot({ path: path.join(output, 'copy-partial.png'), fullPage: false });
    await input().press('z'); await poll(() => practice.locator('.typing-error').isVisible(), 'red typo feedback');
    await poll(async () => await input().inputValue() === '', 'automatic word reset');
    assert.equal((await get()).session.summary.turnsDone, 0);
    await input().pressSequentially('cancel');
    await poll(async () => (await get()).session.current?.round === 1, 'automatic retry after corrected typo');
    assert.equal((await get()).session.summary.mistakes, 1); assert.equal((await get()).session.summary.firstCorrect, 0);
    await finishCopy(); assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline);
    checks.push('Default Copy: direct letter coloring, typo flash/reset, no Enter/Next/Check, automatic advance and typo-aware scoring');
    await send(popup, { type: 'IMPORT_DATA', jsonData: JSON.stringify(words.slice(1)) }); baseline = await send(popup, { type: 'EXPORT_DATA' });
    await click(practice, 'Practice again'); await ready();
    const before = (await get()).session.current;
    await input().pressSequentially(before.word); await poll(async () => (await get()).session.current?.turnId !== before.turnId, 'next distinct word'); await ready();
    const current = (await get()).session.current;
    await input().pressSequentially(current.word.slice(0, 2));
    await click(practice, 'Pause'); assert.equal(await input().isEnabled(), false); await resume(); assert.equal(await input().inputValue(), current.word.slice(0, 2));
    await practice.evaluate(() => chrome.storage.local.set({ appearance: 'light' })); await practice.locator('[data-theme="light"]').waitFor();
    await poll(() => practice.locator('.typing-word > span:not(.letter-correct):not(.letter-wrong)').evaluateAll(letters => letters.every(el => getComputedStyle(el).color === 'rgb(49, 56, 75)')), 'settled light-theme word contrast');
    await practice.screenshot({ path: path.join(output, 'copy-light.png'), fullPage: false });
    await practice.evaluate(() => chrome.storage.local.set({ appearance: 'dark' })); await practice.locator('[data-theme="dark"]').waitFor();
    await poll(() => practice.locator('.letter-correct').evaluateAll(letters => letters.every(el => getComputedStyle(el).color === 'rgb(120, 201, 151)')), 'settled dark-theme colors');
    await practice.setViewportSize({ width: 390, height: 844 }); assert.ok(await practice.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await practice.screenshot({ path: path.join(output, 'copy-mobile.png'), fullPage: true }); await practice.setViewportSize({ width: 1280, height: 800 });
    const sid = (await get()).session.id; await context.close(); context = undefined; await launch();
    practice = await context.newPage(); await practice.goto(`chrome-extension://${id}/practice.html`); await resume();
    assert.equal((await get()).session.id, sid); assert.equal((await get()).session.current.interrupted, true);
    await input().fill(''); await finishCopy(); assert.equal(await send(popup, { type: 'EXPORT_DATA' }), baseline);
    checks.push('Continuous multi-word input, explicit pause/resume, process restart, light/dark and 390px layout');
    await click(practice, 'Spelling'); await click(practice, 'New round'); await ready();
    assert.equal((await get()).session.current.word, undefined);
    const recalled = (await get()).session.current;
    const correct = words.find(w => w.history[0].definition.meanings[0].definitions[0].definition === recalled.prompt).word;
    await input().fill(correct); assert.equal((await get()).session.current.turnId, recalled.turnId); await input().press('Enter');
    await poll(async () => (await get()).session.current?.turnId !== recalled.turnId, 'spelling Enter result');
    await practice.locator('.practice-answer-feedback').filter({ hasText: correct }).waitFor();
    assert.equal(await input().count(), 0);
    await practice.screenshot({ path: path.join(output, 'spelling-feedback.png'), fullPage: false });
    await click(practice, 'Continue'); await ready();
    assert.equal(await practice.locator('.practice-answer-feedback').count(), 0);
    assert.equal((await get()).session.current.word, undefined);
    await input().fill('wrong'); await input().press('Enter');
    await practice.locator('.practice-answer-feedback').filter({ hasText: 'Incorrect' }).waitFor();
    await practice.screenshot({ path: path.join(output, 'spelling-incorrect.png'), fullPage: false });
    await click(practice, 'Copy'); await click(practice, 'Cancel'); assert.equal((await get()).session.mode, 'recall');
    await click(practice, 'Copy'); await click(practice, 'Start new round'); await ready();
    const activeWord = (await get()).session.current.word; await input().pressSequentially(activeWord.slice(0, 2));
    const entries = await send(popup, { type: 'GET_WORDS' }), otherWord = entries.find(e => e.word !== activeWord);
    await send(popup, { type: 'DELETE_WORD', word: otherWord.id });
    await practice.getByText('1 changed or removed words excluded', { exact: true }).waitFor(); assert.equal(await input().inputValue(), activeWord.slice(0, 2));
    const tab = await context.newPage(); await tab.goto(practice.url()); await click(tab, 'Resume'); await poll(async () => !await input().isEnabled(), 'second tab takeover');
    await tab.close(); await resume(); await input().fill(''); await finishCopy();
    await practice.getByText(/Retries .*Hints .*Assisted .*Interrupted .*Skipped/).waitFor();
    const finalSummary = (await get()).session.summary;
    if (finalSummary.needsWork.length) {
      for (const word of finalSummary.needsWork) assert.ok((await practice.getByRole('list', { name: 'Words to practice again' }).innerText()).includes(word.word));
    }
    await poll(() => practice.locator('.practice-progress').evaluate(el => Math.abs(el.firstElementChild.getBoundingClientRect().width - el.getBoundingClientRect().width) < 1), 'settled completed progress');
    assert.ok(await practice.locator('.practice-progress').evaluate(el => el.getBoundingClientRect().top - document.querySelector('.practice-end-actions').getBoundingClientRect().bottom >= 16));
    await practice.screenshot({ path: path.join(output, 'results.png'), fullPage: false });
    await practice.setViewportSize({ width: 390, height: 844 });
    assert.ok(await practice.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await practice.screenshot({ path: path.join(output, 'results-mobile.png'), fullPage: true });
    await practice.setViewportSize({ width: 1280, height: 800 });
    checks.push('Spelling feedback before continuing, confirmed mode switch, unrelated-word update and tab takeover preserve data boundaries');
    await openSettingsClear(false); assert.ok((await get()).session); await openSettingsClear(true);
    await poll(async () => (await get()).session === null, 'confirmed clearing');
    assert.equal((await send(popup, { type: 'GET_WORDS' })).length, 2);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    const result = { version, archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), browser: context.browser().version(), viewport: { width: 1280, height: 800 }, checks, requests, errors,
      limitations: ['Disposable Chrome profile, synthetic vocabulary only.', 'Speech logic tested with mocked device voices; actual audio quality and physical IME remain manual checks.', 'No hosted account or real vocabulary used.'] };
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Browser diagnostics:', JSON.stringify({ errors, requests, diagnostics, text: await practice?.locator('body').innerText().catch(() => ''),
      view: await practice?.evaluate(() => chrome.runtime.sendMessage({ type: 'PRACTICE_GET' })).catch(e => String(e)),
      cache: await practice?.evaluate(() => new Promise(resolve => {
        const open = indexedDB.open('rememberme-translation-cache-v1', 1);
        open.onerror = () => resolve(String(open.error));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('entries')) { db.close(); resolve('no entries store'); return; }
          const tx = db.transaction('entries'), request = tx.objectStore('entries').getAll();
          tx.oncomplete = () => { db.close(); resolve({ rows: request.result, now: Date.now() }); };
        };
      })).catch(e => String(e)) }));
    await practice?.screenshot({ path: path.join(os.tmpdir(), 'rememberme-typing-flow-failure.png'), fullPage: true }).catch(() => {}); throw error;
  } finally { await context?.close(); await rm(fixture, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
