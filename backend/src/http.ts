import { ApiError, MAX_BODY_BYTES, json } from '../../contracts/api-v1';

export async function boundedJSON(body: ReadableStream<Uint8Array> | null, maximum = MAX_BODY_BYTES): Promise<unknown> {
  if (!body) throw new ApiError('INVALID_JSON');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ApiError('BODY_TIMEOUT', 408, true)), 10_000); });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) throw new ApiError('REQUEST_TOO_LARGE', 413);
      chunks.push(result.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data));
    if (!json(value)) throw new ApiError('INVALID_JSON');
    return value;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError('INVALID_JSON');
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
export async function requestJSON(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase().endsWith('/json')) throw new ApiError('JSON_REQUIRED', 415);
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_BODY_BYTES) throw new ApiError('REQUEST_TOO_LARGE', 413);
  return boundedJSON(request.body);
}
export function base64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function token(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function challenge(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('='); if (key === name) return rest.join('=');
  }
  return null;
}
export function checkOrigin(request: Request, origin: string, clients = '') {
  const value = request.headers.get('Origin');
  if (value && ![origin, ...clients.split(',').filter(Boolean)].includes(value)) throw new ApiError('ORIGIN_REJECTED', 403);
}
export async function providerJSON(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ApiError('LOGIN_PROVIDER_UNAVAILABLE', 502, true);
  return boundedJSON(response.body, 64 * 1024);
}
