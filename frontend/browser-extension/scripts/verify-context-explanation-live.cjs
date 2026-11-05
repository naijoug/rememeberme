// Explicit production lookup acceptance: synthetic sentences only, exact release ZIP, disposable profile.
const {chromium}=require(process.env.REMEMBERME_PLAYWRIGHT_PATH||'playwright');
const {mkdtemp,mkdir,readFile,writeFile,rm}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');const {createServer}=require('node:http');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const origin='https://rememberme-lookup.couplelabs.workers.dev';
(async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'rememberme-live-explanation-'));
 const extension=path.join(temporary,'extension');await mkdir(extension);
 const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 execFileSync('unzip',['-q',path.join(root,`.output/remember-me-${version}-chrome.zip`),'-d',extension]);
 const output=process.env.REMEMBERME_ACCEPTANCE_DIR||path.join(root,'.output/live-explanation-acceptance');await mkdir(output,{recursive:true});
 const disabled=process.argv.includes('--expect-disabled');let context,server;
 const report={version,mode:disabled?'disabled-gate':'live-enabled',origin,checks:[],productionVocabularyUsed:false};
 try{
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{headless:true,channel:'chromium',viewport:{width:1100,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(25000);const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');report.browser=context.browser().version();
  const id=new URL(worker.url()).hostname;
  const capability=await worker.evaluate(async origin=>{const r=await fetch(origin+'/api/v1/public/lookup/capabilities',{credentials:'omit'});return {status:r.status,data:await r.json()};},origin);
  assert.equal(capability.status,200);assert.equal(capability.data.enabled,!disabled);report.capability=capability;
  if(disabled){
   const rejected=await worker.evaluate(async origin=>{const r=await fetch(origin+'/api/v1/public/lookup/context-explanation',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,word:'bank',context:'The bank approved my mortgage.',target:'zh-CN'})});return {status:r.status,data:await r.json()};},origin);
   assert.equal(rejected.status,503);assert.equal(rejected.data.error.code,'EXPLANATION_DISABLED');report.checks.push('Public off switch rejects source before inference');
  }else{
   server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><title>Release sentence fixture</title><style>body{font:24px Georgia;background:#faf9f6;color:#243029;padding:80px}p{max-width:650px;line-height:1.7}</style><h1>Live sentence acceptance</h1><p>The <span id="word">bank</span> approved my mortgage.</p></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
   const posts=[];context.on('request',req=>{if(req.url().endsWith('/context-explanation'))posts.push({url:req.url(),body:JSON.parse(req.postData())});});
   const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);const cdp=await context.newCDPSession(page);
   const children=n=>[...(n.children||[]),...(n.shadowRoots||[])];const text=n=>(n.nodeType===3?n.nodeValue:'')+children(n).map(text).join(' ');
   const attrs=n=>Object.fromEntries((n.attributes||[]).reduce((a,v,i,all)=>{if(i%2===0)a.push([v,all[i+1]]);return a;},[]));
   function find(n,p){if(p(n))return n;for(const c of children(n)){const r=find(c,p);if(r)return r;}}
   async function tree(){return (await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;}
   async function cardText(){const card=find(await tree(),n=>attrs(n).role==='dialog');return card?text(card):'';}
   async function poll(check,label){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+label+'; '+await cardText());}
   async function click(label){const node=find(await tree(),n=>n.nodeName==='BUTTON'&&text(n).trim()===label);assert.ok(node,'Missing '+label);const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId:node.backendNodeId});const q=model.border;await page.mouse.click((q[0]+q[4])/2,(q[1]+q[5])/2);}
   await page.locator('#word').dblclick();await poll(async()=>/Explain this sentence/.test(await cardText()),'entry');assert.equal(posts.length,0);
   await click('Explain this sentence');await poll(async()=>/Enable and explain/.test(await cardText()),'consent');
   const consentTree=await tree();
   const enableNode=find(consentTree,n=>n.nodeName==='BUTTON'&&text(n).trim()==='Enable and explain');
   const cancelNode=find(consentTree,n=>n.nodeName==='BUTTON'&&text(n).trim()==='Cancel');
   const enableBox=(await cdp.send('DOM.getBoxModel',{backendNodeId:enableNode.backendNodeId})).model.border;
   const cancelBox=(await cdp.send('DOM.getBoxModel',{backendNodeId:cancelNode.backendNodeId})).model.border;
   assert.ok(cancelBox[0]-enableBox[2]>=11,'Consent controls must have visible separation inside the closed shadow root');
   await click('Cancel');assert.equal(posts.length,0);
   await click('Explain this sentence');await click('Enable and explain');await poll(async()=>/AI explanation/.test(await cardText()),'finance explanation');
   assert.match(await cardText(),/银行|金融/);await page.screenshot({path:path.join(output,'live-finance.png')});
   await page.keyboard.press('Escape');await page.locator('p').evaluate(p=>{p.innerHTML='We sat on the <span id="word">bank</span> of the river.';});
   await page.locator('#word').dblclick();await poll(async()=>/Explain this sentence/.test(await cardText()),'second entry');await click('Explain this sentence');await poll(async()=>/AI explanation/.test(await cardText()),'river explanation');
   assert.match(await cardText(),/河岸|岸边|河畔/);await page.screenshot({path:path.join(output,'live-river.png')});
   assert.equal(posts.length,2);for(const item of posts){assert.equal(item.url,origin+'/api/v1/public/lookup/context-explanation');assert.deepEqual(Object.keys(item.body).sort(),['context','schemaVersion','target','word']);}
   assert.notEqual(posts[0].body.context,posts[1].body.context);report.checks.push('Exact ZIP: consent controls are separated, cancel sends no source; live finance/river meanings differ; exact source fields only');
   const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.getByRole('button',{name:'Settings',exact:true}).click();await popup.getByRole('button',{name:'Disable sentence explanation',exact:true}).click();
   await poll(async()=>!/AI explanation/.test(await cardText()),'clear after disable');
   const words=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'GET_WORDS'}));assert.deepEqual(words.data,[]);
   const exported=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'EXPORT_DATA'}));assert.equal(exported.data,'[]');
   report.checks.push('Settings revocation clears explanation; no saved words or export changes');
  }
  await writeFile(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await context?.close();if(server)await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
