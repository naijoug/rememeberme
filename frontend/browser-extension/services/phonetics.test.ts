import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipaShard, PhoneticsService } from './phonetics';

const asset = (name: string) => resolve('public/dictionary/ipa', name);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function localFetch() {
  return vi.fn(async (path: string) => new Response(await readFile(asset(path.split('/').at(-1)!), 'utf8')));
}

describe('packaged phonetic transcriptions', () => {
  it('reads real US/UK IPA for reported words and the exact inflected spelling, coalescing local reads', async () => {
    const fetch = localFetch(); vi.stubGlobal('fetch', fetch);
    const service = new PhoneticsService(path => path);
    const first = service.getPhonetics(' Trick ');
    const second = service.getPhonetics('trick');
    expect(await first).toEqual({ us: '/ˈtɹɪk/', uk: '/tɹˈɪk/' });
    expect(await second).toEqual(await first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatch(/^\/dictionary\/ipa\/[0-9a-f]{2}\.json$/);
    expect(await service.getPhonetics('having')).toEqual({ us: '/ˈhævɪŋ/', uk: '/hˈævɪŋ/' });
    expect(await service.getPhonetics('consumption')).toMatchObject({ uk: '/kənsˈʌmpʃən/' });
    expect((await service.getPhonetics('read')).us).toContain(',');
    expect(await service.getPhonetics('remembermefixtureword')).toEqual({});
    await expect(service.getPhonetics('<img src=x>')).rejects.toThrow('single English word');
  });

  it('bounds stalled local JSON reads and permits recovery after failure', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal('fetch', fetch);
    const service = new PhoneticsService(path => path);
    const assertion = expect(service.getPhonetics('trick')).rejects.toThrow('could not be loaded');
    await vi.advanceTimersByTimeAsync(1500); await assertion;
    fetch.mockImplementation(localFetch());
    expect(await service.getPhonetics('trick')).toHaveProperty('us', '/ˈtɹɪk/');
  });

  it('validates assets rather than accepting malformed or inherited entries', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ trick: [{ text: 'invalid' }, null] })));
    vi.stubGlobal('fetch', fetch);
    await expect(new PhoneticsService(path => path).getPhonetics('trick')).rejects.toThrow('unavailable');
    fetch.mockResolvedValue(new Response('{}'));
    expect(await new PhoneticsService(path => path).getPhonetics('constructor')).toEqual({});
  });

  it('ships complete indexed shards and matching original source with license notices', async () => {
    const metadata = JSON.parse(await readFile(asset('metadata.json'), 'utf8'));
    const originals: Record<string, Record<string, string>> = {};
    for (const [accent, file] of [['us', 'en_US.txt'], ['uk', 'en_UK.txt']]) {
      const source = gunzipSync(await readFile(asset(file + '.gz')));
      expect(createHash('sha256').update(source).digest('hex')).toBe(metadata.sourceHashesSha256[file!]);
      originals[accent!] = Object.fromEntries(source.toString('utf8').trim().split('\n').map(line => {
        const [word, text] = line.split('\t'); return [word!.toLowerCase(), text];
      }));
    }
    let count = 0;
    for (let index = 0; index < metadata.shards; index++) {
      const key = index.toString(16).padStart(2, '0');
      const data = JSON.parse(await readFile(asset(key + '.json'), 'utf8'));
      for (const [word, entry] of Object.entries(data) as Array<[string, Array<string | null>]>) {
        if (ipaShard(word) !== key || (entry[0] && originals.us![word] !== entry[0]) || (entry[1] && originals.uk![word] !== entry[1])) {
          throw new Error(`Invalid source mapping for ${word}`);
        }
        count++;
      }
    }
    expect(count).toBe(metadata.entries);
    expect(count).toBeGreaterThan(140000);
    expect(await readFile(asset('en-UK-LICENSE.txt'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(await readFile(asset('en-US-LICENSE.txt'), 'utf8')).toContain('MIT License');
  });
});
