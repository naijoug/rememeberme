import { afterEach, expect, it, vi } from 'vitest';
import { ContextExplanationService } from './context-explanation';
import { explanationCapabilities, EXPLANATION_CAPABILITIES_PATH, type ContextExplanationInput } from '../../../contracts/context-explanation';
vi.mock('wxt/utils/storage', () => ({ storage: {} }));
const input: ContextExplanationInput = { schemaVersion: 1, word: 'bank', context: 'The bank raised interest rates.', target: 'zh-CN' };
const response = { schemaVersion: 1, contextualMeaning: '<b>银行</b>', sentenceTranslation: '银行提高了利率。', usageNote: '', provider: 'magpie', explanationVersion: 'context-v1' };
afterEach(() => vi.useRealTimers());
it('requires both build opt-in and explicit consent before sending source text', async () => {
  const request=vi.fn();
  await expect(new ContextExplanationService({request},async()=>true,false).explain(input)).rejects.toThrow('Enable');
  await expect(new ContextExplanationService({request},async()=>false,true).explain(input)).rejects.toThrow('Enable');
  expect(request).not.toHaveBeenCalled();
});
it('separates sentence caches, rechecks the capability, and clears on disable', async () => {
  let enabled=true;
  const request=vi.fn(async(path:string)=>path===EXPLANATION_CAPABILITIES_PATH? explanationCapabilities(enabled) : response);
  const service=new ContextExplanationService({request} as any,async()=>true,true);
  await service.explain(input); await service.explain(input);
  expect(request.mock.calls.filter(([path])=>path!==EXPLANATION_CAPABILITIES_PATH)).toHaveLength(1);
  await service.explain({...input,context:'The river bank is steep.'});
  expect(request.mock.calls.filter(([path])=>path!==EXPLANATION_CAPABILITIES_PATH)).toHaveLength(2);
  enabled=false; await expect(service.explain(input)).rejects.toThrow('unavailable');
  enabled=true; await service.explain(input);
  expect(request.mock.calls.filter(([path])=>path!==EXPLANATION_CAPABILITIES_PATH)).toHaveLength(3);
  service.clear(); await service.explain(input);
  expect(request.mock.calls.filter(([path])=>path!==EXPLANATION_CAPABILITIES_PATH)).toHaveLength(4);
});
it('rejects malformed or cancelled explanations without retaining results', async () => {
  let complete!: (value:unknown)=>void;
  const request=vi.fn((path:string)=>path===EXPLANATION_CAPABILITIES_PATH?Promise.resolve(explanationCapabilities(true)):new Promise(resolve=>{complete=resolve;}));
  let consent=true; const service=new ContextExplanationService({request} as any,async()=>consent,true);
  const promise=service.explain(input); const check=expect(promise).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2)); consent=false; service.clear(); await check;
  complete(response); consent=true;
  const next=service.explain(input); await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(4)); complete({...response,provider:'unknown'});
  await expect(next).rejects.toThrow('invalid sentence');
});

it('blocks source transmission if consent is revoked while the initial consent read is pending', async () => {
  let grant!:(value:boolean)=>void;const request=vi.fn();
  const service=new ContextExplanationService({request},()=>new Promise(resolve=>{grant=resolve;}),true);
  const pending=service.explain(input);service.clear();grant(true);
  await expect(pending).rejects.toThrow('Enable');expect(request).not.toHaveBeenCalled();
});

it('expires in-memory results and evicts older sentences at the configured bound', async () => {
  vi.useFakeTimers();
  const request=vi.fn(async(path:string)=>path===EXPLANATION_CAPABILITIES_PATH?explanationCapabilities(true):response);
  const service=new ContextExplanationService({request} as any,async()=>true,true);
  const posts=()=>request.mock.calls.filter(([path])=>path!==EXPLANATION_CAPABILITIES_PATH).length;
  await service.explain(input);await service.explain(input);expect(posts()).toBe(1);
  await vi.advanceTimersByTimeAsync(30*60_000+1);await service.explain(input);expect(posts()).toBe(2);
  for(let i=0;i<101;i++)await service.explain({...input,context:'A bank sentence '+i});
  const before=posts();await service.explain({...input,context:'A bank sentence 100'});expect(posts()).toBe(before);
  await service.explain({...input,context:'A bank sentence 0'});expect(posts()).toBe(before+1);
});
