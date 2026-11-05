import { storage } from 'wxt/utils/storage';
export const EXPLANATION_CONSENT_KEY = 'local:contextExplanationConsent';
export const explanationConsent = (value: unknown): boolean => !!value && typeof value === 'object' &&
  'version' in value && value.version === 1 && 'enabled' in value && value.enabled === true;
export async function hasExplanationConsent() { return explanationConsent(await storage.getItem(EXPLANATION_CONSENT_KEY)); }
export async function saveExplanationConsent(enabled: boolean) { await storage.setItem(EXPLANATION_CONSENT_KEY, { version: 1, enabled }); }
export function watchExplanationConsent(callback: (enabled: boolean) => void): () => void {
  let active = true, version = 0;
  const stop = storage.watch(EXPLANATION_CONSENT_KEY, value => { version++; if (active) callback(explanationConsent(value)); });
  const start = version;
  void hasExplanationConsent().then(value => { if (active && start === version) callback(value); }).catch(() => { if (active && start === version) callback(false); });
  return () => { active = false; try { stop(); } catch { /* Extension invalidated. */ } };
}
