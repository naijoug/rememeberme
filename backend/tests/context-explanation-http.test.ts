import { expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
// @ts-expect-error The bridge is a production Node module without separate TS declarations.
import { createLookupBridge } from '../scripts/lookup-bridge.mjs';
import { app } from '../src/index';
import { env } from './node-bindings';
import { WindowLimiter } from '../src/node-runtime';
import fixture from '../../contracts/fixtures/context-explanation-v1.json';
import { EXPLANATION_PATH, EXPLANATION_CAPABILITIES_PATH } from '../../contracts/context-explanation';

it('runs real loopback HTTP through bridge and API with route-specific byte limits and live disable', async () => {
  env.LOOKUP_LIMIT=new WindowLimiter(100); env.EXPLANATION_LIMIT=new WindowLimiter(100);
  const explain=vi.fn().mockResolvedValue(fixture.response); env.EXPLAINER={explain};
  const api=serve({fetch:request=>app.fetch(request,env),hostname:'127.0.0.1',port:0});
  if(!api.listening) await once(api,'listening');
  const address=api.address(); if(!address || typeof address==='string') throw new Error('Missing fixture port');
  const apiBase='http://127.0.0.1:'+address.port;
  const bridge=createLookupBridge({fetcher:(url:string,init:RequestInit)=>fetch(apiBase+new URL(url).pathname,init)});
  bridge.listen(0,'127.0.0.1'); await once(bridge,'listening');
  const base='http://127.0.0.1:'+bridge.address().port;
  const post=(path:string,body:string)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.11'},body});
  try {
    expect((await (await fetch(base+EXPLANATION_CAPABILITIES_PATH)).json()).enabled).toBe(true);
    const multibyte=JSON.stringify({...fixture.request,context:'中'.repeat(1000)}); expect(Buffer.byteLength(multibyte)).toBeGreaterThan(2048);
    expect((await post(EXPLANATION_PATH,multibyte)).status).toBe(200);
    expect(explain).toHaveBeenCalledTimes(1);
    for (const context of ['bank' + '\u0000'.repeat(996), 'bank' + '😀'.repeat(498)]) {
      const encoded=JSON.stringify({...fixture.request,context});
      expect(Buffer.byteLength(encoded)).toBeGreaterThan(2048);
      expect((await post(EXPLANATION_PATH,encoded)).status).toBe(200);
      expect(explain.mock.calls.at(-1)?.[0].context).toBe(context);
    }
    expect((await post('/api/v1/public/lookup/translation',multibyte)).status).toBe(413);
    expect((await post(EXPLANATION_PATH,'x'.repeat(16385))).status).toBe(413);
    expect((await post(EXPLANATION_PATH,JSON.stringify({...fixture.request,url:'https://private.test'}))).status).toBe(400);
    delete env.EXPLAINER;
    expect((await (await fetch(base+EXPLANATION_CAPABILITIES_PATH)).json()).enabled).toBe(false);
    expect((await post(EXPLANATION_PATH,JSON.stringify(fixture.request))).status).toBe(503);
    expect((await fetch(base+'/api/v1/me')).status).toBe(404);
  } finally {
    await Promise.all([new Promise<void>(resolve=>{bridge.close(resolve);bridge.closeAllConnections();}),new Promise<void>(resolve=>{api.close(()=>resolve());api.closeAllConnections();})]);
  }
});
