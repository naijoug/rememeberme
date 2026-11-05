import { EXPLANATION_PATH, EXPLANATION_CAPABILITIES_PATH, isContextExplanationInput, isContextExplanation,
  isExplanationCapabilities, type ContextExplanation, type ContextExplanationInput, type ExplanationCapabilities } from '../../../contracts/context-explanation';
import { publicLookupClient, type PublicLookupClient } from './public-lookup';
import { SharedLookup } from './shared-lookup';
import { hasExplanationConsent } from './explanation-settings';
import { CONTEXT_EXPLANATION_ENABLED } from '~/config/backend';

export class ContextExplanationService {
  private pending = new SharedLookup<ContextExplanation>(20_000, 'Sentence explanation timed out. Please try again.');
  private cache = new Map<string, { value: ContextExplanation; expires: number }>();
  private generation = 0;
  constructor(private client: Pick<PublicLookupClient, 'request'> = publicLookupClient,
    private consent = hasExplanationConsent, private enabled = CONTEXT_EXPLANATION_ENABLED) {}
  clear() { this.generation++; this.cache.clear(); this.pending.clear(); }
  async capabilities(signal?: AbortSignal): Promise<ExplanationCapabilities> {
    if (!this.enabled) throw new Error('Sentence explanation is unavailable in this build.');
    const value = await this.client.request<unknown>(EXPLANATION_CAPABILITIES_PATH, 'GET', undefined, signal);
    if (!isExplanationCapabilities(value)) throw new Error('Sentence explanation requires a compatible service.');
    return value;
  }
  async explain(input: ContextExplanationInput, signal?: AbortSignal): Promise<ContextExplanation> {
    signal?.throwIfAborted();
    const generation = this.generation;
    const allowed = this.enabled && await this.consent();
    if (!allowed || generation !== this.generation) throw new Error('Enable sentence explanation before sending a sentence.');
    if (!isContextExplanationInput(input)) throw new Error('Select one English word in a sentence of at most 1,000 characters.');
    // Check the live server switch even on a cached hit; never re-use word-only caches.
    const capability = await this.capabilities(signal);
    signal?.throwIfAborted();
    if (!capability.enabled) { this.clear(); throw new Error('Sentence explanation is currently unavailable.'); }
    const stillAllowed = await this.consent();
    if (!stillAllowed || generation !== this.generation) throw new Error('Sentence explanation was disabled.');
    signal?.throwIfAborted();
    const key = JSON.stringify([input.word.toLowerCase(), input.context, input.target, capability.explanationVersion]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    return this.pending.run(key, async requestSignal => {
      const value = await this.client.request<unknown>(EXPLANATION_PATH, 'POST', { ...input, word: input.word.toLowerCase() }, requestSignal);
      requestSignal.throwIfAborted();
      const stillAllowed = await this.consent();
      if (!stillAllowed || generation !== this.generation) throw new Error('Sentence explanation was disabled.');
      requestSignal.throwIfAborted();
      if (!isContextExplanation(value)) throw new Error('The service returned an invalid sentence explanation.');
      this.cache.delete(key); this.cache.set(key, { value, expires: Date.now() + 30 * 60_000 });
      while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
      return value;
    }, signal);
  }
}
export const contextExplanationService = new ContextExplanationService();
