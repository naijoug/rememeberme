import { TRANSLATION_CIRCUIT_COOLDOWN_MS, TRANSLATION_CIRCUIT_FAILURES } from '../../contracts/translation-policy';

/** Per word-translator instance; independent of sentence explanation and caches. */
export class TranslationCircuit {
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private generation = 0;

  enter(): ((success: boolean) => void) | undefined {
    if (this.probing || Date.now() < this.openUntil) return;
    const probe = this.openUntil !== 0;
    if (probe) this.probing = true;
    const generation = this.generation;
    let finished = false;
    return success => {
      if (finished || generation !== this.generation) return;
      finished = true;
      if (probe) this.probing = false;
      if (success) {
        this.failures = 0;
        this.openUntil = 0;
        if (probe) this.generation++;
      } else if (probe || ++this.failures >= TRANSLATION_CIRCUIT_FAILURES) {
        this.openUntil = Date.now() + TRANSLATION_CIRCUIT_COOLDOWN_MS;
        // An older concurrent completion must not close or extend this circuit.
        this.generation++;
      }
    };
  }
}
