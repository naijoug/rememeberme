// Opt-in build only. Real extension ports/UI; synthetic in-worker responses; disposable profile.
const { chromium } = require(process.env.REMEMBERME_PLAYWRIGHT_PATH || 'playwright');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'rememberme-explanation-'));
  const output=process.env.REMEMBERME_ACCEPTANCE_DIR || path.join(root,'.qa/context-explanation');await mkdir(output,{recursive:true});
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><title>Sentence fixture</title><style>body{font:24px Georgia;background:#faf9f6;color:#243029;padding:80px}p{max-width:650px;line-height:1.7}</style><h1>Sentence fixture</h1><p>The <span id="word">bank</span> raised interest rates.</p></html>');});
  let context;
  const results={checks:[],limitations:['Disposable Chrome and synthetic model output; no real provider quality or billing verification.','Opt-in test build only; production build and backend defaults stay disabled.']};
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const extension=path.join(root,'.output/chrome-mv3');
    context=await chromium.launchPersistentContext(path.join(directory,'profile'),{headless:true,channel:'chromium',viewport:{width:1100,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP lookup.couplelabs.cn ~NOTFOUND, MAP rememberme-lookup.couplelabs.workers.dev ~NOTFOUND, MAP rememberme.couplelabs.cn ~NOTFOUND']});
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id=new URL(worker.url()).hostname;results.browser=context.browser().version();
    await worker.evaluate(async()=>{
      const nativeFetch=globalThis.fetch;
      globalThis.fixture={enabled:true,mode:'success',posts:[],aborts:0,translations:0,pending:[]};
      globalThis.fetch=async(url,init={})=>{
        if(!String(url).startsWith('https://rememberme-lookup.couplelabs.workers.dev/'))return nativeFetch(url,init);
        const state=globalThis.fixture;
        const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
        if(String(url).endsWith('/capabilities'))return json({schemaVersion:1,enabled:state.enabled,maxContextLength:1000,maxBodyBytes:16384,explanationVersion:'context-v1'});
        if(String(url).endsWith('/translation')){
          state.translations++;
          return new Promise((resolve,reject)=>{
            state.pending.push(()=>resolve(json({translation:{text:'合成释义',source:'magpie',target:'zh-CN'}})));
            init.signal.addEventListener('abort',()=>{state.aborts++;reject(new DOMException('cancelled','AbortError'));},{once:true});
          });
        }
        if(String(url).endsWith('/context-explanation')){
          state.posts.push(JSON.parse(init.body));
          const result={schemaVersion:1,contextualMeaning:'银行 <img src=x onerror=alert(1)>',sentenceTranslation:'银行提高了利率。',usageNote:'这里指金融机构。',provider:'magpie',explanationVersion:'context-v1'};
          if(state.mode==='invalid')return json({...result,provider:'untrusted'});
          if(state.mode==='pending')return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>{state.aborts++;reject(new DOMException('cancelled','AbortError'));},{once:true});});
          return json(result);
        }
        return json({});
      };
      await chrome.storage.local.set({translationCache:{'public:v3:bank':{text:'银行',source:'magpie',timestamp:Date.now()}}});
    });
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);const cdp=await context.newCDPSession(page);
    const children=node=>[...(node.children||[]),...(node.shadowRoots||[])];
    const text=node=>(node.nodeType===3?node.nodeValue:'')+children(node).map(text).join(' ');
    async function nodes(){return (await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;}
    function find(node,predicate){if(predicate(node))return node;for(const child of children(node)){const found=find(child,predicate);if(found)return found;}}
    const attributes=node=>Object.fromEntries((node.attributes||[]).reduce((a,v,i,all)=>{if(i%2===0)a.push([v,all[i+1]]);return a;},[]));
    async function card(){return find(await nodes(),node=>attributes(node).role==='dialog');}
    async function cardText(){const node=await card();return node?text(node):'';}
    async function poll(check,label){for(let i=0;i<120;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timeout: '+label);}
    async function click(label){const node=find(await nodes(),n=>n.nodeName==='BUTTON'&&text(n).trim()===label);assert.ok(node,'Missing '+label);const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId:node.backendNodeId});const q=model.border;await page.mouse.click((q[0]+q[4])/2,(q[1]+q[5])/2);}
    async function select(){await page.keyboard.press('Escape');await page.locator('#word').dblclick();await poll(async()=>/Explain this sentence/.test(await cardText()),'explanation entry');}
    await select();assert.equal(await worker.evaluate(()=>fixture.posts.length),0);
    await click('Explain this sentence');await poll(async()=>/does not send the page URL/.test(await cardText()),'disclosure');
    await click('Cancel');assert.equal(await worker.evaluate(()=>fixture.posts.length),0);
    await click('Explain this sentence');await click('Enable and explain');
    await poll(async()=>/AI explanation/.test(await cardText()),'explanation result');
    const sent=await worker.evaluate(()=>fixture.posts);assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0]).sort(),['context','schemaVersion','target','word']);
    assert.equal(sent[0].word,'bank');assert.equal(sent[0].context,'The bank raised interest rates.');
    assert.match(await cardText(),/<img src=x onerror=alert\(1\)>/);assert.equal(find(await card(),node=>node.nodeName==='IMG'),undefined);
    await page.screenshot({path:path.join(output,'explanation.png')});
    results.checks.push('Consent is required; cancel sends no context; exact word/sentence payload; literal model output');
    const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
    const message=data=>popup.evaluate(data=>chrome.runtime.sendMessage(data),data);
    // Real client/background ports share one logical translation; no source persistence.
    await popup.evaluate(()=>{
      window.portResults={};window.ports={};
      for(const id of ['a','b']){
        const port=chrome.runtime.connect({name:'rememberme-lookup-v1'});ports[id]=port;
        port.onMessage.addListener(reply=>{portResults[id]=reply;});
        port.postMessage({type:'start',requestId:id,sessionId:id,operation:'GET_TRANSLATION',payload:{word:'coalesced'}});
      }
    });
    await poll(async()=>await worker.evaluate(()=>fixture.translations===1),'one shared request');
    await popup.evaluate(()=>ports.a.postMessage({type:'cancel',requestId:'a',sessionId:'a'}));
    assert.equal(await worker.evaluate(()=>fixture.aborts),0);
    await worker.evaluate(()=>fixture.pending.shift()());
    await poll(async()=>await popup.evaluate(()=>portResults.b?.type==='result'),'remaining subscriber result');
    await popup.evaluate(()=>{const port=chrome.runtime.connect({name:'rememberme-lookup-v1'});ports.c=port;port.postMessage({type:'start',requestId:'c',sessionId:'c',operation:'GET_TRANSLATION',payload:{word:'cancelled'}});});
    await poll(async()=>await worker.evaluate(()=>fixture.translations===2),'last subscription');
    await popup.evaluate(()=>ports.c.disconnect());await poll(async()=>await worker.evaluate(()=>fixture.aborts===1),'last subscriber abort');
    results.checks.push('Two real ports share one request; cancelling A preserves B; last-port disconnect aborts');
    await worker.evaluate(()=>{fixture.mode='pending';});
    await select();await click('Explain this sentence');
    // First result was cached, so use a different captured sentence.
    await page.keyboard.press('Escape');await page.locator('p').evaluate(p=>{p.innerHTML='The <span id="word">bank</span> is beside the river.';});
    await select();await click('Explain this sentence');
    await poll(async()=>await worker.evaluate(()=>fixture.posts.length===2),'pending explanation');
    assert.equal((await message({type:'EXPLANATION_CONSENT',enabled:false})).success,true);
    await poll(async()=>await worker.evaluate(()=>fixture.aborts===2),'consent abort');
    await poll(async()=>!/AI explanation/.test(await cardText()),'result cleared');
    await worker.evaluate(()=>{fixture.enabled=false;fixture.mode='success';});
    await page.keyboard.press('Escape');await page.locator('#word').dblclick();await poll(async()=>Boolean(await card()),'ordinary card still available');
    await new Promise(resolve=>setTimeout(resolve,300));assert.ok(!/Explain this sentence/.test(await cardText()));
    const words=await message({type:'GET_WORDS'});assert.deepEqual(words.data,[]);
    const exported=await message({type:'EXPORT_DATA'});assert.equal(exported.data,'[]');
    results.checks.push('Consent revocation aborts/clears explanation; capability off hides entry; vocabulary/export remain empty');
    await writeFile(path.join(output,'acceptance.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  }finally{await context?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
