import { storage } from 'wxt/utils/storage';
import type { ThemePreference, ThemeState } from '~/types/theme';

const THEME_KEY = 'local:appearance';
export function normalizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveTheme(preference: ThemePreference): Promise<void> {
  await storage.setItem(THEME_KEY, normalizeTheme(preference));
}

// Appearance is separate from vocabulary, so existing backups remain unchanged.
export function watchTheme(listener: (state: ThemeState) => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference: ThemePreference = 'system';
  let active = true;
  let revision = 0;
  const notify = () => {
    if (active) listener({ preference, resolved: preference === 'system' ? (media.matches ? 'dark' : 'light') : preference });
  };
  const unwatch = storage.watch<ThemePreference>(THEME_KEY, value => {
    revision++;
    preference = normalizeTheme(value);
    notify();
  });
  media.addEventListener('change', notify);
  notify();
  const initialRevision = revision;
  void storage.getItem<ThemePreference>(THEME_KEY).then(value => {
    if (!active || initialRevision !== revision) return;
    preference = normalizeTheme(value);
    notify();
  }).catch(() => { /* Keep the system theme when preferences are unavailable. */ });
  return () => {
    active = false;
    try { unwatch(); } catch { /* An extension reload can invalidate browser listeners first. */ }
    media.removeEventListener('change', notify);
  };
}
