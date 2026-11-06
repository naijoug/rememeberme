import type { PracticeMessage, PracticeCommand, PracticeView } from '~/types/practice';
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).every(k => fields.includes(k));
export function parsePracticeMessage(value: unknown): PracticeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid practice request.');
  const m = value as Record<string, unknown>;
  if (m.type === 'PRACTICE_GET' && exact(m, ['type'])) return { type: 'PRACTICE_GET' };
  if (m.type !== 'PRACTICE_COMMAND' || !exact(m, ['type', 'requestId', 'owner', 'scope', 'revision', 'action'])
    || !id(m.requestId) || !id(m.scope) || typeof m.owner !== 'string' || m.owner.length > 500
    || !Number.isSafeInteger(m.revision) || (m.revision as number) < 0
    || !m.action || typeof m.action !== 'object' || Array.isArray(m.action)) throw new Error('Invalid practice request.');
  const a = m.action as Record<string, unknown>;
  let valid = false;
  switch (a.kind) {
    case 'clear': valid = exact(a, ['kind']); break;
    case 'resume': valid = exact(a, ['kind', 'sessionId']) && id(a.sessionId); break;
    case 'reveal': valid = exact(a, ['kind', 'turnId']) && id(a.turnId); break;
    case 'start': valid = exact(a, ['kind', 'mode', 'replace', 'entryIds']) && ['copy', 'recall'].includes(String(a.mode)) && typeof a.replace === 'boolean'
      && (a.entryIds === undefined || Array.isArray(a.entryIds) && a.entryIds.length <= 10 && a.entryIds.every(id)); break;
    case 'answer': valid = exact(a, ['kind', 'turnId', 'answer', 'assisted', 'skipped', 'elapsedMs', 'mistakes', 'advance']) && id(a.turnId)
      && typeof a.answer === 'string' && a.answer.length <= 500 && typeof a.assisted === 'boolean' && typeof a.skipped === 'boolean'
      && Number.isFinite(a.elapsedMs) && (a.elapsedMs as number) >= 0 && (a.elapsedMs as number) <= 3_600_000
      && (a.mistakes === undefined || Number.isSafeInteger(a.mistakes) && (a.mistakes as number) >= 0 && (a.mistakes as number) <= 10_000)
      && (a.advance === undefined || typeof a.advance === 'boolean'); break;
  }
  if (!valid) throw new Error('Invalid practice action.');
  return value as PracticeCommand;
}
export async function handlePracticeMessage(value: unknown, sender: { url?: string; frameId?: number; id?: string }, root: string,
  repository: { practice(message: PracticeMessage): Promise<PracticeView> }) {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !value.type.startsWith('PRACTICE_')) return undefined;
  try {
    const url = new URL(sender.url ?? '');
    if (![root + 'practice.html', root + 'popup.html'].includes(url.origin + url.pathname)
      // Chrome extension URLs have an opaque URL.origin in some runtimes.
      && ![root + 'practice.html', root + 'popup.html'].includes(url.href.split(/[?#]/)[0])) throw new Error('Practice requires an extension page.');
    if (sender.frameId !== undefined && sender.frameId !== 0) throw new Error('Practice requires a top-level extension page.');
    return { success: true as const, data: await repository.practice(parsePracticeMessage(value)) };
  } catch (cause) { return { success: false as const, error: cause instanceof Error ? cause.message : 'Practice is unavailable.' }; }
}
