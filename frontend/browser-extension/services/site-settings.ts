import { storage } from 'wxt/utils/storage';

export const SITE_SETTINGS_KEY = 'local:siteSettings';
export interface SiteSettings { schemaVersion: 1; disabledHosts: string[] }
export interface SiteAccess { enabled: boolean; hostname: string | null; error?: string }
export interface SiteStatus { settings: SiteSettings | null; error?: string; hostname: string | null; tabId?: number; enabled: boolean }
const invalid = () => new Error('Website settings could not be read. Restore website settings to resume lookups.');

export function siteHostname(url: string | undefined): string | null {
  try {
    const parsed = new URL(url ?? '');
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/\.$/, '') || null : null;
  } catch { return null; }
}
function normalizeHostname(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\s/@?#\\]/.test(value)) throw invalid();
  const url = new URL('https://' + value);
  if (url.port || url.pathname !== '/' || !url.hostname) throw invalid();
  return siteHostname(url.href)!;
}
export function parseSiteSettings(raw: unknown): SiteSettings {
  if (raw == null) return { schemaVersion: 1, disabledHosts: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const value = raw as Record<string, unknown>;
  // v0 is the prototype schema; migrate in memory and persist only on an explicit edit.
  if (![0, 1].includes(value.schemaVersion as number) || !Array.isArray(value.disabledHosts) || value.disabledHosts.length > 500) throw invalid();
  return { schemaVersion: 1, disabledHosts: [...new Set(value.disabledHosts.map(normalizeHostname))].sort() };
}

export class SiteSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private persistence = {
    read: () => storage.getItem<unknown>(SITE_SETTINGS_KEY),
    write: (value: SiteSettings) => storage.setItem(SITE_SETTINGS_KEY, value),
  }) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }
  read(): Promise<SiteSettings> { return this.serial(async () => parseSiteSettings(await this.persistence.read())); }
  setEnabled(hostname: string, enabled: boolean): Promise<SiteSettings> {
    return this.serial(async () => {
      const host = normalizeHostname(hostname);
      const current = parseSiteSettings(await this.persistence.read());
      const hosts = new Set(current.disabledHosts);
      if (enabled) hosts.delete(host); else hosts.add(host);
      const next = parseSiteSettings({ schemaVersion: 1, disabledHosts: [...hosts] });
      await this.persistence.write(next); return next;
    });
  }
  reset(): Promise<SiteSettings> {
    return this.serial(async () => {
      const next: SiteSettings = { schemaVersion: 1, disabledHosts: [] };
      await this.persistence.write(next); return next;
    });
  }
  async access(url: string | undefined): Promise<SiteAccess> {
    const hostname = siteHostname(url);
    try {
      const settings = await this.read();
      const readableFile = url?.startsWith('file:') === true;
      return { hostname, enabled: hostname ? !settings.disabledHosts.includes(hostname) : readableFile };
    } catch (error) { return { hostname, enabled: false, error: error instanceof Error ? error.message : 'Website settings unavailable.' }; }
  }
}
export const siteSettings = new SiteSettingsStore();

/** Watch settings changes, but always ask the background for the trusted top-level site. */
export function watchSiteAccess(listener: (value: SiteAccess) => void): () => void {
  let active = true, revision = 0;
  listener({ enabled: false, hostname: null });
  const refresh = () => {
    const version = ++revision;
    // Keep an already-enabled page open until its own policy is resolved.
    // Background admission still rejects new requests from a disabled site.
    // An edit to another hostname must not close this page's shared subscription.
    void browser.runtime.sendMessage({ type: 'SITE_ACCESS' }).then(reply => {
      if (active && version === revision) listener(reply?.success && typeof reply.data?.enabled === 'boolean'
        ? reply.data : { enabled: false, hostname: null });
    }).catch(() => { if (active && version === revision) listener({ enabled: false, hostname: null }); });
  };
  const stop = storage.watch(SITE_SETTINGS_KEY, refresh);
  refresh();
  return () => { active = false; revision++; try { stop(); } catch { /* Context invalidated. */ } };
}
