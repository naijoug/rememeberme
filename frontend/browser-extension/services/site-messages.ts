import { siteHostname, type SiteSettingsStore, type SiteStatus } from './site-settings';
import type { BackgroundResponse } from '~/types';

interface Sender { url?: string; tab?: { id?: number }; frameId?: number }
interface Tabs { get(id: number): Promise<{ id?: number; url?: string }>; query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>> }
export async function senderPageURL(sender: Sender, tabs: Pick<Tabs, 'get'>): Promise<string | undefined> {
  if (sender.tab?.id == null) return undefined;
  try { return (await tabs.get(sender.tab.id)).url; } catch { return undefined; }
}
export async function handleSiteMessage(message: unknown, sender: Sender, store: SiteSettingsStore, tabs: Tabs,
  extensionURL: string): Promise<BackgroundResponse<unknown> | undefined> {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string' || !message.type.startsWith('SITE_')) return undefined;
  const data = message as Record<string, unknown>;
  try {
    if (data.type === 'SITE_ACCESS') return { success: true, data: await store.access(await senderPageURL(sender, tabs)) };
    if (!sender.url?.startsWith(extensionURL)) throw new Error('Website controls require an extension page.');
    if (data.type === 'SITE_STATUS') {
      const tab = (await tabs.query({ active: true, currentWindow: true }))[0];
      const hostname = siteHostname(tab?.url);
      let settings: SiteStatus['settings'] = null, error: string | undefined;
      try { settings = await store.read(); } catch (cause) { error = cause instanceof Error ? cause.message : 'Website settings unavailable.'; }
      return { success: true, data: { settings, error, hostname, tabId: tab?.id,
        enabled: Boolean(settings && hostname && !settings.disabledHosts.includes(hostname)) } satisfies SiteStatus };
    }
    if (data.type === 'SITE_SET_CURRENT') {
      if (!Number.isInteger(data.tabId) || typeof data.hostname !== 'string' || typeof data.enabled !== 'boolean') throw new Error('Invalid website setting.');
      const tab = (await tabs.query({ active: true, currentWindow: true }))[0];
      if (tab?.id !== data.tabId || !siteHostname(tab.url) || siteHostname(tab.url) !== data.hostname) throw new Error('The active website changed. Reopen settings and try again.');
      return { success: true, data: await store.setEnabled(data.hostname, data.enabled) };
    }
    if (data.type === 'SITE_ENABLE_HOST' && typeof data.hostname === 'string') return { success: true, data: await store.setEnabled(data.hostname, true) };
    if (data.type === 'SITE_RESET') return { success: true, data: await store.reset() };
    throw new Error('Invalid website setting.');
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Website settings unavailable.' }; }
}

export const siteGatedRequests = new Set(['GET_DEFINITION', 'GET_TRANSLATION', 'GET_PHONETICS', 'SAVE_WORD', 'EXPLAIN_CONTEXT', 'EXPLANATION_CAPABILITIES']);

export async function checkPageSitePolicy(message: unknown, sender: Sender, store: SiteSettingsStore,
  tabs: Pick<Tabs, 'get'>, extensionURL?: string): Promise<void> {
  if (extensionURL && sender.url?.startsWith(extensionURL)) return;
  if (!sender.tab || !message || typeof message !== 'object' || !('type' in message) || !siteGatedRequests.has(String(message.type))) return;
  const access = await store.access(await senderPageURL(sender, tabs));
  if (!access.enabled) throw new Error(access.error ?? 'Remember Me is disabled on this website. Enable it in Settings to continue.');
}
