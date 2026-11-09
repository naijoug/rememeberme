import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import ContextExplanation from './ContextExplanation.vue';
import { explanationCapabilities } from '../../../contracts/context-explanation';
const mocks=vi.hoisted(()=>({ port:vi.fn(), callbacks:[] as Array<(enabled:boolean)=>void>, initial:false }));
vi.mock('~/services/lookup-port-client',()=>({portLookup:mocks.port}));
vi.mock('~/services/explanation-settings',()=>({watchExplanationConsent:(fn:(enabled:boolean)=>void)=>{mocks.callbacks.push(fn);fn(mocks.initial);return ()=>{};}}));
let app:App,root:HTMLElement;
const result={schemaVersion:1,contextualMeaning:'<img src=x onerror=alert(1)>',sentenceTranslation:'银行提高了利率。',usageNote:'',provider:'magpie',explanationVersion:'context-v1'};
beforeEach(()=>{mocks.initial=false;mocks.callbacks=[];mocks.port.mockReset().mockImplementation(async(op)=>op==='EXPLANATION_CAPABILITIES'?explanationCapabilities(true):result);vi.stubGlobal('browser',{runtime:{sendMessage:vi.fn(async()=>({success:true}))}});});
afterEach(()=>{app?.unmount();root?.remove();vi.unstubAllGlobals();});
async function mount(){root=document.createElement('div');document.body.append(root);const state=reactive({word:'bank',context:'The bank raised interest rates.'});app=createApp({render:()=>h(ContextExplanation,state)});app.mount(root);await nextTick();await nextTick();return state;}
function click(text:string){const button=Array.from(root.querySelectorAll('button')).find(b=>b.textContent===text);expect(button).toBeTruthy();button!.click();}
it('requires confirmation and preserves untrusted model text literally',async()=>{
  await mount();click('Explain this sentence');await nextTick();expect(root.textContent).toContain('does not send the page URL');
  expect(mocks.port).toHaveBeenCalledTimes(1);click('Cancel');await nextTick();expect(mocks.port).toHaveBeenCalledTimes(1);
  click('Explain this sentence');await nextTick();click('Enable and explain');
  await vi.waitFor(()=>expect(root.textContent).toContain(result.contextualMeaning));expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('.definition-source')).toBeNull();
  expect(root.textContent).toContain(result.sentenceTranslation);
  expect(mocks.port.mock.calls[1][1]).toEqual({schemaVersion:1,word:'bank',context:'The bank raised interest rates.',target:'zh-CN'});
});
it('cancels on selection changes and consent revocation, keeping late results hidden',async()=>{
  mocks.initial=true;let complete!:(value:unknown)=>void;
  mocks.port.mockImplementation((op)=>op==='EXPLANATION_CAPABILITIES'?Promise.resolve(explanationCapabilities(true)):new Promise(resolve=>{complete=resolve;}));
  const state=await mount();click('Explain this sentence');await nextTick();
  const signal=mocks.port.mock.calls.find(([op])=>op==='EXPLAIN_CONTEXT')![3] as AbortSignal;
  state.context='The river bank is steep.';await nextTick();expect(signal.aborted).toBe(true);complete(result);await nextTick();expect(root.textContent).not.toContain(result.contextualMeaning);
  await nextTick();click('Explain this sentence');await nextTick();mocks.callbacks[0](false);complete(result);await nextTick();expect(root.textContent).not.toContain(result.contextualMeaning);
});
it('hides the entry on unavailable capabilities and does not send an empty sentence',async()=>{
  mocks.port.mockResolvedValue(explanationCapabilities(false));await mount();expect(root.querySelector('button')).toBeNull();
});
