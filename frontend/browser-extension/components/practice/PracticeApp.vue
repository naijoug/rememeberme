<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { PracticeClient } from '~/services/practice-client';
import { watchTheme } from '~/services/theme';
import type { PracticeAction, PracticeMode, PracticeView } from '~/types/practice';
import TypingInput from './TypingInput.vue';

const client = new PracticeClient();
const view = ref<PracticeView>();
const busy = ref(false), error = ref(''), paused = ref(true), answer = ref(''), assisted = ref(false);
const composing = ref(false);
const mode = ref<PracticeMode>('recall'), theme = ref('light');
const input = ref<InstanceType<typeof TypingInput>>();
const resumeButton = ref<HTMLButtonElement>(), completedHeading = ref<HTMLHeadingElement>();
const confirm = ref<'start' | 'clear' | null>(null), cancelButton = ref<HTMLButtonElement>();
let stopTheme: (() => void) | undefined, disposed = false, startedAt = 0, elapsed = 0, generation = 0;
let notification: ReturnType<typeof setTimeout> | undefined;
const session = computed(() => view.value?.session), current = computed(() => session.value?.current);
const summary = computed(() => session.value?.summary);
const active = computed(() => !paused.value && !!current.value?.started && !error.value && !busy.value);
const canSubmit = computed(() => active.value && !composing.value);
const rate = computed(() => summary.value?.total ? `${Math.round(100 * summary.value.firstCorrect / summary.value.total)}%` : '—');
function stopClock() { if (startedAt) { elapsed += Math.max(0, performance.now() - startedAt); startedAt = 0; } }
function pause() { stopClock(); paused.value = true; composing.value = false; }
async function focus() {
  await nextTick();
  if (active.value) input.value?.focus();
  else if (session.value?.completed) completedHeading.value?.focus();
  else resumeButton.value?.focus();
}
function take(next: PracticeView) {
  const previous = view.value, before = previous?.session?.current, after = next.session?.current;
  const changed = next.owner !== previous?.owner || next.scope !== previous?.scope || next.revision !== previous?.revision;
  const sameTurn = before && after && previous?.owner === next.owner && previous.scope === next.scope
    && previous.blocked === next.blocked && previous.session?.id === next.session?.id
    && before.turnId === after.turnId && before.activationId === after.activationId
    && before.hinted === after.hinted && before.interrupted === after.interrupted && before.started === after.started
    && before.prompt === after.prompt && before.word === after.word && before.source === after.source;
  const resetAttempt = !sameTurn && (changed || previous?.session?.id !== next.session?.id || previous?.blocked !== next.blocked);
  view.value = next;
  if (changed) confirm.value = null;
  if (resetAttempt) {
    pause(); confirm.value = null; answer.value = ''; assisted.value = false; elapsed = 0;
    startedLocally = undefined;
    if (next.session) mode.value = next.session.mode;
  }
  return resetAttempt;
}
async function load(recover = false) {
  if (busy.value) return;
  const id = ++generation; busy.value = true; error.value = '';
  try {
    const next = recover ? await client.recover() : await client.get();
    if (!disposed && id === generation) take(next);
  } catch (cause) { if (!disposed && id === generation) { pause(); error.value = cause instanceof Error ? cause.message : 'Practice is unavailable.'; } }
  finally { if (id === generation) busy.value = false; }
}
async function run(action: PracticeAction, activate = false) {
  if (!view.value || busy.value) return;
  stopClock(); busy.value = true; error.value = ''; const id = ++generation;
  try {
    const next = await client.command(view.value, action);
    if (disposed || id !== generation) return;
    take(next);
    if (activate && next.session?.current && !document.hidden && document.hasFocus()) { paused.value = false; startedAt = performance.now(); }
  } catch (cause) { if (!disposed && id === generation) { pause(); error.value = cause instanceof Error ? cause.message : 'Could not save practice.'; } }
  finally { if (id === generation) busy.value = false; }
  await focus();
}
function submit(skipped = false) {
  if (!canSubmit.value || !current.value) return;
  stopClock();
  void run({ kind: 'answer', turnId: current.value.turnId, answer: answer.value, assisted: assisted.value, skipped, elapsedMs: Math.min(3_600_000, Math.round(elapsed)) });
}
async function continueSession() {
  if (!session.value || busy.value) return;
  // A local focus pause retains the same in-memory attempt. A fresh/reconnected page
  // must ask the backend to mark the already-started question interrupted.
  if (current.value?.started && startedLocally === current.value.turnId) {
    paused.value = false; startedAt = performance.now(); await focus();
  } else {
    await run({ kind: 'resume', sessionId: session.value.id }, true);
    startedLocally = current.value?.turnId;
  }
}
let startedLocally: string | undefined;
async function start(entryIds?: string[]) {
  await run({ kind: 'start', mode: mode.value, replace: true, ...(entryIds ? { entryIds } : {}) }, true);
  startedLocally = current.value?.turnId;
}
async function ask(kind: 'start' | 'clear') {
  if (kind === 'start' && !session.value?.current) { await start(); return; }
  confirm.value = kind; pause(); await nextTick(); cancelButton.value?.focus();
}
async function confirmAction() {
  const kind = confirm.value; confirm.value = null;
  if (!kind) return;
  if (kind === 'start') await start(); else await run({ kind: 'clear' });
}
function trapDialog(event: KeyboardEvent) {
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
}
async function reveal() {
  if (!canSubmit.value || !current.value) return;
  const retained = answer.value, wasAssisted = assisted.value, time = elapsed + (startedAt ? performance.now() - startedAt : 0);
  await run({ kind: 'reveal', turnId: current.value.turnId }, true);
  if (!error.value) { answer.value = retained; assisted.value = wasAssisted; elapsed = time; startedLocally = current.value?.turnId; }
}
function changed(message: unknown) {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'PRACTICE_CHANGED') return;
  clearTimeout(notification);
  notification = setTimeout(async () => {
    if (disposed) return;
    if (busy.value) { changed(message); return; }
    const id = ++generation;
    try {
      const next = await client.get();
      if (!disposed && !busy.value && id === generation && take(next)) startedLocally = undefined;
    } catch { if (!disposed && id === generation) { pause(); error.value = 'The background disconnected. Reconnect to check your session.'; } }
  }, 100);
}
function visibility() { if (document.hidden) pause(); }
onMounted(() => {
  stopTheme = watchTheme(v => { theme.value = v.resolved; });
  browser.runtime.onMessage.addListener(changed);
  window.addEventListener('blur', pause); document.addEventListener('visibilitychange', visibility);
  void load();
});
onUnmounted(() => {
  disposed = true; generation++; stopClock(); clearTimeout(notification); stopTheme?.();
  browser.runtime.onMessage.removeListener(changed); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', visibility);
});
</script>

<template>
  <main class="rm-theme practice-page" :data-theme="theme" @keydown.esc="confirm ? confirm = null : pause()">
    <header class="practice-header"><div><p class="practice-eyebrow">REMEMBER ME</p><h1>Typing practice</h1></div><span class="practice-owner">{{ view?.label || 'Opening vocabulary…' }}</span></header>
    <p class="practice-intro">A little time with your own words. Practice stays in this browser and does not change your forgotten counts or review dates.</p>
    <div v-if="error || client.pending" class="practice-alert" role="alert">
      <p>{{ error || 'An earlier save needs recovery before you continue.' }}</p>
      <button class="rm-button rm-secondary" :disabled="busy" @click="startedLocally = undefined; load(true)">Reconnect and recover</button>
    </div>
    <p v-if="view?.blocked" class="practice-alert" role="status">{{ view.blocked }}</p>
    <section v-if="view" class="practice-controls" aria-label="Practice settings">
      <label>Mode <select v-model="mode" :disabled="busy"><option value="recall">Spelling from meaning</option><option value="copy">Copy the word</option></select></label>
      <button class="rm-button" :disabled="busy || !!view.blocked || !!client.pending || !view.available[mode]" @click="ask('start')">Start a new round</button>
      <button class="rm-button rm-secondary" :disabled="busy || !!client.pending" @click="pause(); startedLocally = undefined; load()">Reload vocabulary</button>
      <p class="practice-note">{{ view.available[mode] }} available · {{ view.available.excluded }} excluded · Up to 10 words per round</p>
      <p v-if="!view.available[mode]" role="status">{{ mode === 'recall' && view.available.copy ? 'No saved meanings for spelling. Choose Copy the word.' : 'Save English words or import a vocabulary backup to begin.' }}</p>
    </section>
    <section v-if="session && !error && !client.pending" class="practice-card" aria-label="Current practice session">
      <div class="practice-card-top"><span>{{ session.mode === 'recall' ? 'Spelling from meaning' : 'Copy the word' }}</span><span>{{ summary?.answered }} / {{ summary?.total }} words</span></div>
      <p v-if="session.invalidated" class="practice-note" role="status">{{ session.invalidated }} changed or removed words were excluded from this round.</p>
      <template v-if="session.completed"><h2 ref="completedHeading" tabindex="-1">Round complete</h2><p>Your practice is saved on this device.</p></template>
      <template v-else-if="paused || !current?.started">
        <h2>{{ session.last && !current?.started ? (session.last.correct ? 'Correct' : session.last.skipped ? 'Skipped' : 'Keep practicing') : 'Ready when you are' }}</h2>
        <p v-if="session.last && !current?.started" class="practice-feedback" role="status">{{ session.last.word }}</p>
        <p v-else class="practice-note">Time is paused. Resuming an unfinished question after reloading is marked as interrupted.</p>
        <button ref="resumeButton" class="rm-button" :disabled="busy" @click="continueSession">{{ current?.started ? 'Resume practice' : 'Next word' }}</button>
      </template>
      <template v-else-if="current">
        <p class="practice-note">{{ current.round ? `Retry ${current.round} of 2` : 'First attempt' }}<span v-if="current.interrupted"> · Interrupted attempt</span></p>
        <p class="practice-prompt">{{ current.prompt || 'Copy the saved spelling below.' }}</p>
        <p v-if="current.prompt" class="practice-note">Saved meaning · {{ current.source }}</p>
        <TypingInput ref="input" v-model="answer" :target="current.word" :disabled="!active" @submit="submit()" @assisted="assisted = true" @composing="composing = $event" />
        <p v-if="current.hinted || assisted" class="practice-note">{{ current.hinted ? 'Answer revealed' : 'Assisted input' }} · This attempt does not count as unassisted.</p>
        <div class="practice-actions"><button class="rm-button" :disabled="!canSubmit" @click="submit()">Check spelling</button>
          <button v-if="session.mode === 'recall' && !current.hinted" class="rm-button rm-secondary" :disabled="!canSubmit" @click="reveal">Show answer</button>
          <button class="rm-button rm-secondary" :disabled="!canSubmit" @click="submit(true)">Skip</button>
          <button class="rm-button rm-secondary" :disabled="busy" @click="pause">Pause</button></div>
      </template>
    </section>
    <section v-if="summary && !error && !client.pending" class="practice-summary" aria-label="Practice results">
      <h2>{{ session?.mode === 'copy' ? 'Copy results' : 'Spelling results' }}</h2>
      <div class="practice-metrics"><div><strong>{{ rate }}</strong><span>First attempt, unassisted</span></div><div><strong>{{ summary.retryCorrect }} / {{ summary.retries }}</strong><span>Correct retries</span></div><div><strong>{{ Math.round(summary.elapsedMs / 1000) }}s</strong><span>Active answer time</span></div></div>
      <p class="practice-note">Hints {{ summary.hinted }} · Assisted {{ summary.assisted }} · Interrupted {{ summary.interrupted }} · Skipped {{ summary.skipped }}</p>
      <template v-if="session?.completed && summary.needsWork.length"><h3>Keep practicing</h3><p>{{ summary.needsWork.map(w => w.word).join(' · ') }}</p><button class="rm-button rm-secondary" :disabled="busy" @click="mode = session!.mode; start(summary!.needsWork.map(w => w.id))">Practice these again</button></template>
    </section>
    <footer class="practice-footer"><span>Practice progress is local and is not included in vocabulary backups.</span><button :disabled="busy || !!client.pending || (!session && !view?.corrupt)" class="rm-text-action" @click="ask('clear')">Clear practice records</button></footer>
    <div v-if="confirm" class="practice-modal" @click.self="confirm = null"><section role="dialog" aria-modal="true" aria-labelledby="practice-confirm-title" @keydown.tab="trapDialog">
      <h2 id="practice-confirm-title">{{ confirm === 'clear' ? 'Clear practice records?' : 'Replace this unfinished round?' }}</h2><p>Your vocabulary and forgotten counts stay unchanged.</p>
      <div class="practice-actions"><button ref="cancelButton" class="rm-button rm-secondary" @click="confirm = null">Cancel</button><button class="rm-button" @click="confirmAction">{{ confirm === 'clear' ? 'Clear records' : 'Start new round' }}</button></div>
    </section></div>
  </main>
</template>
