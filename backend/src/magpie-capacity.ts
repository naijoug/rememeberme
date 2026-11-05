/** One per Node runtime. Reserve at least one slot for ordinary word translation. */
export class MagpieCapacity {
  private active = 0;
  private explanations = 0;
  constructor(private maximum = 2) {}
  acquire(kind: 'word' | 'explanation'): (() => void) | undefined {
    if (this.active >= this.maximum || kind === 'explanation' && (this.explanations >= 1 || this.maximum < 2)) return;
    this.active++; if (kind === 'explanation') this.explanations++;
    let released = false;
    return () => { if (released) return; released = true; this.active--; if (kind === 'explanation') this.explanations--; };
  }
}
