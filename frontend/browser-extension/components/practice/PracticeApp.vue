<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Play, Pause, Restart, Settings, NavArrowRight, Xmark } from '@iconoir/vue';
import { PracticeClient } from '~/services/practice-client';
import { watchTheme } from '~/services/theme';
import { asciiLower } from '~/services/practice-engine';
import type { PracticeAction, PracticeMode, PracticeView } from '~/types/practice';
import TypingInput from './TypingInput.vue';
import PracticePronunciation from './PracticePronunciation.vue';
import PracticeMeaning from './PracticeMeaning.vue';

const client = new PracticeClient();
const view = ref<PracticeView>();
const busy = ref(false), error = ref(''), paused = ref(true), answer = ref(''), assisted = ref(false), composing = ref(false);
const mode = ref<PracticeMode>('copy'), theme = ref('light'), settings = ref(false), mistakes = ref(0), notice = ref('');
const input = ref<InstanceType<typeof TypingInput>>(), speech = ref<InstanceType<typeof PracticePronunciation>>();
const resumeButton = ref<HTMLButtonElement>(), completedHeading = ref<HTMLHeadingElement>(), cancelButton = ref<HTMLButtonElement>();
const confirm = ref<'start' | 'clear' | null>(null), nextMode = ref<PracticeMode>('copy');
const elapsed = ref(0), began = ref<number | null>(null), now = ref(performance.now());
let pauseGeneration = 0;
let stopTheme: (() => void) | undefined, disposed = false, generation = 0, startedLocally: string | undefined;
let notification: ReturnType<typeof setTimeout> | undefined, ticker: ReturnType<typeof setInterval> | undefined;
const session = computed(() => view.value?.session), current = computed(() => session.value?.current), summary = computed(() => session.value?.summary);
const active = computed(() => !paused.value && !!current.value?.started && !error.value && !busy.value && !client.pending);
const spellingFeedback = computed(() => session.value?.mode === 'recall' && !!session.value.last && (!current.value || !current.value.started));
const canSubmit = computed(() => active.value && !composing.value);
const currentMs = computed(() => elapsed.value + (began.value === null ? 0 : Math.max(0, now.value - began.value)));
const totalMs = computed(() => (summary.value?.elapsedMs ?? 0) + currentMs.value);
const clock = computed(() => { const s = Math.floor(totalMs.value / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; });
const correctPrefix = computed(() => {
  if (!current.value?.word || assisted.value) return 0;
  const target = asciiLower(current.value.word), typed = asciiLower(answer.value.trim());
  let count = 0; while (count < typed.length && typed[count] === target[count]) count++; return count;
});
const wpm = computed(() => totalMs.value < 1000 ? 0 : Math.round(((summary.value?.characters ?? 0) + correctPrefix.value) * 12_000 / totalMs.value));
const rate = computed(() => summary.value?.answered ? `${Math.round(100 * summary.value.firstCorrect / summary.value.answered)}%` : '—');
const progress = computed(() => { const done = summary.value?.turnsDone ?? 0, left = summary.value?.turnsRemaining ?? 0; return done + left ? done / (done + left) : 0; });
const stageWord = computed(() => session.value?.completed ? 'Round complete' : view.value?.blocked ? 'Practice paused' : !view.value ? 'Loading your words' : 'Ready to type?');
function stopClock() { if (began.value !== null) { elapsed.value += Math.max(0, performance.now() - began.value); began.value = null; } now.value = performance.now(); }
function pause() { pauseGeneration++; stopClock(); paused.value = true; composing.value = false; speech.value?.stop(); }
function activate() { paused.value = false; began.value = performance.now(); now.value = began.value; startedLocally = current.value?.turnId; }
async function focus() { await nextTick(); if (settings.value || confirm.value) return; if (active.value) input.value?.focus(); else if (session.value?.completed) completedHeading.value?.focus(); else resumeButton.value?.focus(); }
function take(next: PracticeView) {
  const previous = view.value, before = previous?.session?.current, after = next.session?.current;
  const changed = next.owner !== previous?.owner || next.scope !== previous?.scope || next.revision !== previous?.revision;
  const sameTurn = before && after && previous?.owner === next.owner && previous.scope === next.scope
    && previous.blocked === next.blocked && previous.session?.id === next.session?.id
    && before.turnId === after.turnId && before.activationId === after.activationId
    && before.hinted === after.hinted && before.interrupted === after.interrupted && before.started === after.started
    && before.prompt === after.prompt && before.word === after.word && before.source === after.source;
  const reset = !sameTurn && (changed || previous?.session?.id !== next.session?.id || previous?.blocked !== next.blocked);
  view.value = next;
  if (changed) confirm.value = null;
  if (reset) {
    pause(); answer.value = ''; assisted.value = false; elapsed.value = 0; mistakes.value = 0; notice.value = ''; startedLocally = undefined;
    if (next.session) mode.value = next.session.mode;
  }
  return reset;
}
async function load(recover = false) {
  if (busy.value) return;
  const id = ++generation; busy.value = true; error.value = '';
  try { const next = recover ? await client.recover() : await client.get(); if (!disposed && id === generation) take(next); }
  catch (cause) { if (!disposed && id === generation) { pause(); error.value = cause instanceof Error ? cause.message : 'Practice is unavailable.'; } }
  finally { if (id === generation) busy.value = false; }
}
async function run(action: PracticeAction, advance = false) {
  if (!view.value || busy.value) return false;
  stopClock(); busy.value = true; error.value = ''; const id = ++generation, pauseAtStart = pauseGeneration;
  try {
    const next = await client.command(view.value, action);
    if (disposed || id !== generation) return false;
    // A user/lifecycle pause during the save must win over automatic progression.
    const mayAdvance = pauseGeneration === pauseAtStart && !settings.value && !confirm.value;
    take(next);
    if (advance && mayAdvance && next.session?.current && !document.hidden && document.hasFocus()) activate();
    return true;
  } catch (cause) { if (!disposed && id === generation) { pause(); error.value = cause instanceof Error ? cause.message : 'Could not save practice.'; } return false; }
  finally { if (id === generation) { busy.value = false; await focus(); } }
}
async function submit(skipped = false) {
  if (!canSubmit.value || !current.value) return;
  stopClock();
  const advance = session.value?.mode === 'copy';
  await run({ kind: 'answer', turnId: current.value.turnId, answer: answer.value, assisted: assisted.value, skipped,
    elapsedMs: Math.min(3_600_000, Math.round(elapsed.value)), mistakes: mistakes.value, advance }, advance);
}
async function continueSession() {
  if (!session.value || busy.value || client.pending || error.value) return;
  if (current.value?.started && startedLocally === current.value.turnId) { activate(); await focus(); }
  else await run({ kind: 'resume', sessionId: session.value.id }, true);
}
async function start(entryIds?: string[], chosenMode = mode.value) {
  await run({ kind: 'start', mode: chosenMode, replace: true, ...(entryIds ? { entryIds } : {}) }, true);
}
async function ask(kind: 'start' | 'clear', chosenMode = mode.value) {
  settings.value = false; nextMode.value = chosenMode;
  if (kind === 'start' && !session.value?.current) { await start(undefined, chosenMode); return; }
  confirm.value = kind; pause(); await nextTick(); cancelButton.value?.focus();
}
function selectMode(next: PracticeMode) {
  if (busy.value || client.pending) return;
  if (session.value?.current && session.value.mode !== next) void ask('start', next);
  else mode.value = next;
}
async function confirmAction() {
  const kind = confirm.value, chosen = nextMode.value; confirm.value = null;
  if (!kind) return;
  if (kind === 'start') await start(undefined, chosen); else await run({ kind: 'clear' });
}
function trapDialog(event: KeyboardEvent) {
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
}
async function reveal() {
  if (!canSubmit.value || !current.value) return;
  const retained = answer.value, wasAssisted = assisted.value, time = currentMs.value;
  await run({ kind: 'reveal', turnId: current.value.turnId }, true);
  if (!error.value) { answer.value = retained; assisted.value = wasAssisted; elapsed.value = time; }
}
function typo() { mistakes.value = Math.min(10_000, mistakes.value + 1); notice.value = 'Try the whole word again'; }
function changed(message: unknown) {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'PRACTICE_CHANGED') return;
  clearTimeout(notification);
  notification = setTimeout(async () => {
    if (disposed) return;
    if (busy.value) { changed(message); return; }
    const id = ++generation;
    try { const next = await client.get(); if (!disposed && !busy.value && id === generation) take(next); }
    catch { if (!disposed && id === generation) { pause(); error.value = 'The background disconnected. Reconnect to check your session.'; } }
  }, 100);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || composing.value || event.repeat) return;
  if (event.key === 'Escape') { if (confirm.value) confirm.value = null; else if (settings.value) settings.value = false; else pause(); return; }
  if (confirm.value || error.value || client.pending || busy.value || settings.value) return;
  if (event.altKey && event.key === 'ArrowRight' && canSubmit.value) { event.preventDefault(); void submit(true); return; }
  if (event.altKey && event.code === 'KeyP') { event.preventDefault(); speech.value?.play(); return; }
  const control = event.target instanceof Element ? event.target.closest('input,textarea,select,button,[contenteditable=true]') : null;
  if (control || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter' && !active.value && !view.value?.blocked) {
    event.preventDefault(); if (current.value) void continueSession(); else if (view.value?.available[mode.value]) void start();
  } else if (active.value && event.key.length === 1) {
    event.preventDefault(); input.value?.focus(); input.value?.insert(event.key);
  }
}
function visibility() { if (document.hidden) pause(); }
onMounted(() => {
  stopTheme = watchTheme(v => { theme.value = v.resolved; });
  browser.runtime.onMessage.addListener(changed);
  window.addEventListener('keydown', keydown); window.addEventListener('blur', pause); document.addEventListener('visibilitychange', visibility);
  ticker = setInterval(() => { now.value = performance.now(); }, 250);
  void load();
});
onUnmounted(() => {
  disposed = true; generation++; stopClock(); clearTimeout(notification); clearInterval(ticker); stopTheme?.();
  browser.runtime.onMessage.removeListener(changed); window.removeEventListener('keydown', keydown); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', visibility);
});
</script>

<template>
  <main class="practice-page" :data-theme="theme" :aria-busy="busy">
    <header class="practice-header">
      <div class="practice-brand"><img src="/icon/48.png" alt="" width="28" height="28" /><span>Remember Me</span><span class="practice-section-name">Typing</span></div>
      <nav class="practice-toolbar" aria-label="Practice controls">
        <div class="practice-mode" role="group" aria-label="Practice mode"><button :aria-pressed="mode === 'copy'" :disabled="busy" @click="selectMode('copy')">Copy</button><button :aria-pressed="mode === 'recall'" :disabled="busy" @click="selectMode('recall')">Spelling</button></div>
        <button class="practice-icon-button" :disabled="busy || !view || !!view.blocked || !!client.pending || !view.available[mode]" aria-label="New round" title="New round" @click="ask('start')"><Restart width="21" height="21" aria-hidden="true" /></button>
        <button class="practice-icon-button" :aria-expanded="settings" aria-label="Practice settings" title="Practice settings" @click="pause(); settings = !settings"><Settings width="21" height="21" aria-hidden="true" /></button>
        <button v-if="current" class="practice-button toolbar-play" :disabled="busy || !!client.pending || !!error" @click="active ? pause() : continueSession()"><Pause v-if="active" width="17" height="17" aria-hidden="true" /><Play v-else width="17" height="17" aria-hidden="true" />{{ active ? 'Pause' : 'Resume' }}</button>
      </nav>
      <section v-if="settings" class="practice-settings" aria-label="Practice settings panel">
        <div class="practice-settings-title"><strong>{{ view?.label }}</strong><button class="practice-icon-button" aria-label="Close settings" @click="settings = false"><Xmark width="18" height="18" /></button></div>
        <p>{{ view?.available[mode] ?? 0 }} available · {{ view?.available.excluded ?? 0 }} excluded</p>
        <button :disabled="busy || !!client.pending" @click="settings = false; pause(); startedLocally = undefined; load()">Reload vocabulary</button>
        <button :disabled="busy || !!client.pending || (!session && !view?.corrupt)" @click="ask('clear')">Clear practice records</button>
        <p class="practice-note">Progress stays on this device. Your word counts and review dates stay unchanged.</p>
      </section>
    </header>
    <div class="practice-context"><span>{{ view?.label || 'Loading vocabulary…' }}</span><span v-if="session">{{ summary?.answered }} / {{ summary?.total }} words<span v-if="current?.round"> · Retry {{ current.round }}/2</span></span><span v-else-if="view">{{ view.available[mode] }} words ready</span></div>
    <section class="practice-stage" :class="{ 'is-paused': !!current && paused, 'is-saving': busy, 'is-complete': session?.completed }" aria-label="Typing area" @click.self="focus">
      <div v-if="error || client.pending" class="practice-error" role="alert"><h2>Let’s reconnect</h2><p>{{ error || 'Recover the previous save before continuing.' }}</p><button class="practice-button" :disabled="busy" @click="startedLocally = undefined; load(true)">Reconnect and recover</button></div>
      <template v-else-if="spellingFeedback && current">
        <div class="practice-answer-feedback" role="status">
          <p>{{ session!.last!.skipped ? 'Skipped' : session!.last!.correct ? 'Correct' : 'Incorrect' }}</p>
          <h2 class="practice-idle-title">{{ session!.last!.word }}</h2>
        </div>
        <button ref="resumeButton" class="continue-typing" @click="continueSession">Continue</button>
      </template>
      <template v-else-if="current">
        <div class="practice-word-line">
          <TypingInput :key="current.turnId + current.activationId" ref="input" v-model="answer" :target="current.word" :auto="session?.mode === 'copy'" :disabled="!active" @submit="submit()" @complete="submit()" @mistake="typo" @assisted="assisted = true" @composing="composing = $event" />
          <PracticePronunciation v-if="current.word" ref="speech" :word="current.word" @played="focus" />
        </div>
        <PracticeMeaning :word="session?.mode === 'copy' ? current.word : undefined" :meaning="session?.mode === 'copy' ? current.meaning || current.prompt : current.prompt" :source="current.source" />
        <div class="practice-stage-hint" role="status">
          <span v-if="busy">Saving…</span>
          <button v-else-if="paused || !current.started" ref="resumeButton" class="continue-typing" @click="continueSession"><kbd>Enter</kbd> to {{ current.started ? 'resume' : 'continue' }}</button>
          <span v-else-if="notice && !answer">{{ notice }}</span>
          <span v-else-if="session?.mode === 'recall'"><kbd>Enter</kbd> to check your spelling</span>
          <span v-else>Type the word to continue</span>
        </div>
        <div class="practice-word-actions">
          <button v-if="session?.mode === 'recall' && !current.hinted" :disabled="!canSubmit" @click="reveal">Show answer</button>
          <button :disabled="!canSubmit" title="Skip word · Alt+Right Arrow" @click="submit(true)">Skip word <NavArrowRight width="14" height="14" aria-hidden="true" /></button>
        </div>
      </template>
      <template v-else>
        <h1 ref="completedHeading" class="practice-idle-title" tabindex="-1">{{ stageWord }}</h1>
        <p v-if="view?.blocked" class="practice-empty-note" role="status">{{ view.blocked }}</p>
        <template v-else-if="session?.completed">
          <p v-if="spellingFeedback" class="practice-answer-feedback" role="status">{{ session!.last!.skipped ? 'Skipped' : session!.last!.correct ? 'Correct' : 'Incorrect' }}: {{ session!.last!.word }}</p>
          <p class="practice-empty-note">{{ summary?.firstCorrect }} of {{ summary?.total }} words on the first try.</p>
          <p class="practice-result-details">Retries {{ summary?.retryCorrect }} / {{ summary?.retries }} · Hints {{ summary?.hinted }} · Assisted {{ summary?.assisted }} · Interrupted {{ summary?.interrupted }} · Skipped {{ summary?.skipped }}</p>
          <p v-if="summary?.needsWork.length" class="practice-result-details">Words to practice again</p>
          <ul v-if="summary?.needsWork.length" class="practice-difficult-words" aria-label="Words to practice again"><li v-for="word in summary.needsWork" :key="word.id">{{ word.word }}</li></ul>
          <div class="practice-end-actions"><button class="practice-button" :disabled="busy" @click="start()">Practice again</button><button v-if="summary?.needsWork.length" class="practice-button secondary" :disabled="busy" @click="start(summary!.needsWork.map(w => w.id))">Practice difficult words</button></div>
        </template>
        <template v-else-if="view?.available[mode]"><p class="practice-empty-note">{{ mode === 'copy' ? 'See the word. Hear it. Make it yours.' : 'Recall the spelling from its meaning.' }}</p><button class="continue-typing start-typing" :disabled="busy" @click="start()"><kbd>Enter</kbd> to start</button></template>
        <p v-else-if="view" class="practice-empty-note">{{ mode === 'recall' && view.available.copy ? 'No saved meanings yet. Switch to Copy to practice your words.' : 'Save a word while reading, then come back to practice.' }}</p>
      </template>
    </section>
    <div class="practice-progress" role="progressbar" aria-label="Round progress" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress * 100}%` }"></span></div>
    <section class="practice-metrics" aria-label="Practice statistics">
      <div><strong>{{ clock }}</strong><span>Time</span></div>
      <div v-if="mode === 'copy'" title="Completed characters plus the current correct prefix, divided by five per active minute"><strong>{{ wpm }}</strong><span>WPM</span></div><div v-else><strong>{{ rate }}</strong><span>First pass</span></div>
      <div><strong>{{ summary?.answered ?? 0 }}<small> / {{ summary?.total ?? Math.min(view?.available[mode] ?? 0, 10) }}</small></strong><span>Words</span></div>
      <div><strong>{{ mode === 'copy' ? (summary?.mistakes ?? 0) + mistakes : summary?.hinted ?? 0 }}</strong><span>{{ mode === 'copy' ? 'Typos' : 'Hints' }}</span></div>
    </section>
    <footer class="practice-footer"><span><kbd>Esc</kbd> pause <span class="footer-divider">·</span> <kbd>Alt</kbd> <kbd>→</kbd> skip <span class="footer-divider">·</span> <kbd>Alt</kbd> <kbd>P</kbd> pronunciation</span><span v-if="session?.invalidated" role="status">{{ session.invalidated }} changed or removed words excluded</span><span v-else>{{ session?.mode === 'copy' || !session ? 'Correct words advance automatically' : 'Spelling mode' }}</span></footer>
    <div v-if="confirm" class="practice-modal" @click.self="confirm = null"><section role="dialog" aria-modal="true" aria-labelledby="practice-confirm-title" @keydown.tab="trapDialog">
      <h2 id="practice-confirm-title">{{ confirm === 'clear' ? 'Clear practice records?' : `Start a ${nextMode === 'copy' ? 'copy' : 'spelling'} round?` }}</h2><p>{{ confirm === 'clear' ? 'This clears practice progress for the current vocabulary.' : 'This replaces the unfinished round.' }} Your saved words stay unchanged.</p>
      <div class="practice-end-actions"><button ref="cancelButton" class="practice-button secondary" @click="confirm = null">Cancel</button><button class="practice-button" @click="confirmAction">{{ confirm === 'clear' ? 'Clear records' : 'Start new round' }}</button></div>
    </section></div>
  </main>
</template>
