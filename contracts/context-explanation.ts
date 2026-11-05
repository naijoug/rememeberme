/** Context explanations are a separate, ephemeral contract; never a legacy Definition. */
export const EXPLANATION_PATH = '/api/v1/public/lookup/context-explanation';
export const EXPLANATION_CAPABILITIES_PATH = '/api/v1/public/lookup/capabilities';
export const EXPLANATION_VERSION = 'context-v1';
export const EXPLANATION_MAX_BODY = 16 * 1024;
export const EXPLANATION_MAX_CONTEXT = 1000;
export interface ContextExplanationInput { schemaVersion: 1; word: string; context: string; target: 'zh-CN' }
export interface ContextExplanation {
  schemaVersion: 1; contextualMeaning: string; sentenceTranslation: string; usageNote: string;
  provider: 'magpie'; explanationVersion: string;
}
export interface ExplanationCapabilities {
  schemaVersion: 1; enabled: boolean; maxContextLength: 1000; maxBodyBytes: 16384; explanationVersion: string;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim());
export function isContextExplanationInput(value: unknown): value is ContextExplanationInput {
  return record(value) && exact(value, ['schemaVersion', 'word', 'context', 'target']) && value.schemaVersion === 1
    && text(value.word, 500) && /^[a-z](?:[a-z'-]*[a-z])?$/i.test(value.word)
    && text(value.context, EXPLANATION_MAX_CONTEXT) && value.target === 'zh-CN';
}
export function isContextExplanation(value: unknown): value is ContextExplanation {
  return record(value) && exact(value, ['schemaVersion', 'contextualMeaning', 'sentenceTranslation', 'usageNote', 'provider', 'explanationVersion'])
    && value.schemaVersion === 1 && text(value.contextualMeaning, 500) && text(value.sentenceTranslation, 2000)
    && text(value.usageNote, 500, true) && value.provider === 'magpie' && value.explanationVersion === EXPLANATION_VERSION;
}
export function isExplanationCapabilities(value: unknown): value is ExplanationCapabilities {
  return record(value) && exact(value, ['schemaVersion', 'enabled', 'maxContextLength', 'maxBodyBytes', 'explanationVersion'])
    && value.schemaVersion === 1 && typeof value.enabled === 'boolean' && value.maxContextLength === 1000
    && value.maxBodyBytes === 16384 && value.explanationVersion === EXPLANATION_VERSION;
}
export function explanationCapabilities(enabled: boolean): ExplanationCapabilities {
  return { schemaVersion: 1, enabled, maxContextLength: 1000, maxBodyBytes: 16384, explanationVersion: EXPLANATION_VERSION };
}
