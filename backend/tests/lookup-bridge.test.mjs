import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createLookupBridge } from '../scripts/lookup-bridge.mjs';

it('forwards only lookup paths and trusted edge IP, omitting credentials, cookies and client XFF', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ translation: { text: '合成释义', source: 'hermes', target: 'zh-CN' } }),
    { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'should-never-pass', 'Access-Control-Allow-Origin': 'chrome-extension://fixture' } }));
  const server = createLookupBridge({ fetcher }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/api/v1/me', '/api/v1/auth/exchange', '/auth/extension/start', '/api/v1/public/lookup/translation?word=synthetic']) {
      expect((await fetch(base + path)).status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const body = JSON.stringify({ word: 'synthetic', target: 'zh-CN' });
    const reply = await fetch(base + '/api/v1/public/lookup/translation', { method: 'POST', body, headers: {
      'Content-Type': 'application/json', Origin: 'chrome-extension://fixture', Authorization: 'Bearer synthetic', Cookie: 'private',
      'X-Forwarded-For': 'spoofed-client', 'CF-Connecting-IP': '192.0.2.20',
    } });
    expect(reply.status).toBe(200); expect(reply.headers.get('set-cookie')).toBeNull();
    expect(reply.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://fixture');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/api/v1/public/lookup/translation');
    expect(init.headers).toEqual({ Accept: 'application/json', Origin: 'chrome-extension://fixture',
      'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.20' });
    expect(init.body.toString()).toBe(body);
    await fetch(base + '/api/v1/public/lookup/translation', { method: 'POST', body, headers: { 'CF-Connecting-IP': 'spoof,192.0.2.20' } });
    expect(fetcher.mock.calls[1][1].headers['X-Forwarded-For']).toBe('temporary-lookup-unknown');
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});

it('limits request sizes and returns provider failures without exposing internals', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('private upstream error'));
  const server = createLookupBridge({ fetcher }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    expect((await fetch(base + '/api/v1/public/lookup/dictionary', { method: 'POST', body: 'x'.repeat(2049) })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
    const response = await fetch(base + '/api/v1/public/lookup/dictionary', { method: 'POST', body: '{}' });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: { code: 'LOOKUP_UNAVAILABLE' } });
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
