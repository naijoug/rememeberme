import { expect, it, vi } from 'vitest';
import { PublicLookupClient } from './public-lookup';
it('sends only public lookup requests with no credentials and handles rate limits and body bounds', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ definition: {} }), { headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'x'.repeat(256 * 1024) }), { headers: { 'Content-Type': 'application/json' } }));
  const client = new PublicLookupClient('https://api.example.test', fetcher);
  await client.request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  await expect(client.request('/api/v1/me', 'POST', {})).rejects.toThrow('Invalid lookup');
  await expect(client.request('/api/v1/public/lookup/translation', 'POST', { word: 'synthetic' })).rejects.toThrow(/Too many lookups/);
  await expect(client.request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' })).rejects.toThrow(/too large/);
});
