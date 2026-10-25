// Native menu/toolbar acceptance in an isolated, disposable Chrome for Testing profile.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'rememberme-native-release-'));
  const extension = path.join(fixture, 'extension'); await fs.mkdir(extension);
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  execFileSync('unzip', ['-q', path.join(root, `.output/remember-me-${version}-chrome.zip`), '-d', extension]);
  const server = createServer((_req,res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<!doctype html><title>Remember Me isolated native acceptance</title><style>body{font:24px Georgia;margin:80px;background:#f7f6f2}h1{font-size:36px}</style><h1>Remember Me native acceptance</h1><p>Reading can bring a little <span id="target">serendipity</span>.</p><p>Disposable fixture: native context menu and toolbar only.</p>'); });
  let context;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    context = await chromium.launchPersistentContext(path.join(fixture,'profile'), {headless:false,channel:'chromium', viewport:{width:1280,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id=new URL(worker.url()).hostname;
    const page=await context.newPage(); await page.goto('http://127.0.0.1:'+server.address().port+'/native-fixture');
    await fs.writeFile('/private/tmp/rememberme-native-release-ready.json',JSON.stringify({fixture,extensionId:id,browser:context.browser().version(),url:page.url()}));
    console.log('READY for native context-menu and toolbar UI checks in disposable Chrome for Testing.');
    const end=Date.now()+10*60*1000;
    while(Date.now()<end){
      const done=await fs.readFile(path.join(fixture,'native-complete.json'),'utf8').catch(()=>null);
      if(done){
        const verifier = await context.newPage(); await verifier.goto(`chrome-extension://${id}/popup.html`);
        const words=await verifier.evaluate(()=>chrome.runtime.sendMessage({type:'GET_WORDS'}));
        assert.equal(words.success,true); assert.equal(words.data.length,1); assert.equal(words.data[0].word,'serendipity'); assert.equal(words.data[0].count,1); assert.equal(words.data[0].history.length,1);
        const results={version,browser:context.browser().version(),extensionId:id,checks:JSON.parse(done),fixtureOnly:true,wordCount:words.data[0].count,historyCount:words.data[0].history.length};
        await fs.writeFile(path.join(root,'docs/release/assets/native-acceptance.json'),JSON.stringify(results,null,2)+'\n');
        console.log(JSON.stringify(results,null,2)); return;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('Native UI acceptance was not completed; no pass record written.');
  } finally { await context?.close(); await new Promise(resolve=>server.close(resolve)); await fs.rm(fixture,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
