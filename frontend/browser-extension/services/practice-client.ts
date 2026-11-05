import type { PracticeAction, PracticeCommand, PracticeMessage, PracticeView } from '~/types/practice';
import { parsePracticeMessage } from './practice-handler';

type Reply = { success: true; data: PracticeView } | { success: false; error: string };
class Rejected extends Error {}
const PENDING_KEY = 'rememberme:practice-pending:v1';
/** Writes never retry automatically. A tab retains one frozen request across reloads. */
export class PracticeClient {
  pending: PracticeCommand | null = null;
  constructor(private transport: (message: PracticeMessage) => Promise<Reply | undefined> = message => browser.runtime.sendMessage(message),
    private persistence: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = sessionStorage) {
    const raw = persistence.getItem(PENDING_KEY);
    if (raw) { try { const parsed = parsePracticeMessage(JSON.parse(raw)); if (parsed.type === 'PRACTICE_COMMAND') this.pending = parsed; } catch { persistence.removeItem(PENDING_KEY); } }
  }
  private async send(message: PracticeMessage): Promise<PracticeView> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([this.transport(message), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The background did not respond. The save outcome may be unknown; reconnect before continuing.')), 10_000);
      })]);
      if (!reply) throw new Error('The background disconnected. Reconnect to recover this session.');
      if (!reply.success) throw new Rejected(reply.error);
      return reply.data;
    } finally { clearTimeout(timer); }
  }
  get() { return this.send({ type: 'PRACTICE_GET' }); }
  async command(view: PracticeView, action: PracticeAction) {
    if (this.pending) throw new Error('Recover the previous save before continuing.');
    this.pending = { type: 'PRACTICE_COMMAND', requestId: crypto.randomUUID(), scope: view.scope, owner: view.owner, revision: view.revision, action: structuredClone(action) };
    try { this.persistence.setItem(PENDING_KEY, JSON.stringify(this.pending)); }
    catch { this.pending = null; throw new Error('Could not retain this request for recovery. No practice save was sent.'); }
    return this.submit();
  }
  private clearPending() { this.persistence.removeItem(PENDING_KEY); this.pending = null; }
  private async submit() {
    try { const view = await this.send(this.pending!); this.clearPending(); return view; }
    catch (error) { if (error instanceof Rejected) this.clearPending(); throw error; }
  }
  async recover() {
    const view = await this.get();
    if (!this.pending) return view;
    if (view.corrupt) { this.clearPending(); return view; }
    if (this.pending.owner !== view.owner) {
      // A response might have committed in the old partition. Its durable session remains there.
      this.clearPending(); return view;
    }
    this.pending.scope = view.scope; // Reconnect only. Keep the exact operation ID/body/revision.
    this.persistence.setItem(PENDING_KEY, JSON.stringify(this.pending));
    return this.submit();
  }
}
