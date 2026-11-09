<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Play, Pause, Restart, Settings, NavArrowRight, Xmark, SunLight, HalfMoon } from '@iconoir/vue';
import { PracticeClient } from '~/services/practice-client';
import { saveTheme, watchTheme } from '~/services/theme';
import type { PracticeAction, PracticeMode, PracticeView } from '~/types/practice';
import TypingInput from './TypingInput.vue';
import PracticePronunciation from './PracticePronunciation.vue';
import PracticeMeaning from './PracticeMeaning.vue';

const client = new PracticeClient();
const view = ref<PracticeView>();
const busy = ref(false), error = ref(''), paused = ref(true), answer = ref(''), assisted = ref(false), composing = ref(false);
const themeSaving = ref(false), themeError = ref('');
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
const obscured = computed(() => session.value?.mode === 'recall' && !current.value?.hinted);
const totalWords = computed(() => summary.value?.total ?? Math.min(view.value?.available[mode.value] ?? 0, 10));
const wordNumber = computed(() => Math.min((summary.value?.answered ?? 0) + (current.value ? 1 : 0), totalWords.value));
const canSubmit = computed(() => active.value && !composing.value);
const currentMs = computed(() => elapsed.value + (began.value === null ? 0 : Math.max(0, now.value - began.value)));
const totalMs = computed(() => (summary.value?.elapsedMs ?? 0) + currentMs.value);
const clock = computed(() => { const s = Math.floor(totalMs.value / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; });
const stageWord = computed(() => session.value?.completed ? '本轮完成' : view.value?.blocked ? '练习已暂停' : !view.value ? '正在加载单词' : '准备好听写了吗？');
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
  const advance = true;
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
  const retained = answer.value, wasAssisted = assisted.value, time = currentMs.value, retainedMistakes = mistakes.value;
  await run({ kind: 'reveal', turnId: current.value.turnId }, true);
  if (!error.value) { answer.value = retained; assisted.value = wasAssisted; elapsed.value = time; mistakes.value = retainedMistakes; }
}
function typo() { mistakes.value = Math.min(10_000, mistakes.value + 1); notice.value = '再输入一次完整单词'; }
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
  if (event.altKey && event.code === 'KeyP' && active.value) { event.preventDefault(); speech.value?.play(); return; }
  const control = event.target instanceof Element ? event.target.closest('input,textarea,select,button,[contenteditable=true]') : null;
  if (control || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter' && !active.value && !view.value?.blocked) {
    event.preventDefault(); if (current.value) void continueSession(); else if (view.value?.available[mode.value]) void start();
  } else if (active.value && event.key.length === 1) {
    event.preventDefault(); input.value?.focus(); input.value?.insert(event.key);
  }
}
async function toggleTheme() {
  if (themeSaving.value) return;
  themeSaving.value = true; themeError.value = '';
  const next = theme.value === 'dark' ? 'light' : 'dark';
  try { await saveTheme(next); theme.value = next; }
  catch { themeError.value = '主题保存失败，请重试'; }
  finally { themeSaving.value = false; await focus(); }
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
  <main class="practice-page rm-theme" :data-theme="theme" :aria-busy="busy">
    <header class="practice-header">
      <div class="practice-brand"><img src="/icon/48.png" alt="" width="28" height="28" /><span>Remember Me</span><span class="practice-section-name">/ &nbsp;dictation</span></div>
      <nav class="practice-toolbar" aria-label="听写控制">
        <div class="practice-mode" role="group" aria-label="练习模式"><button :aria-pressed="mode === 'copy'" :disabled="busy" @click="selectMode('copy')">看词跟写</button><button :aria-pressed="mode === 'recall'" :disabled="busy" @click="selectMode('recall')">模糊听写</button></div>
        <button class="practice-icon-button" :disabled="themeSaving" :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" @click="toggleTheme"><HalfMoon v-if="theme === 'dark'" width="22" height="22" aria-hidden="true" /><SunLight v-else width="22" height="22" aria-hidden="true" /></button>
        <button class="practice-icon-button" :aria-expanded="settings" aria-label="听写设置" title="听写设置" @click="pause(); settings = !settings"><Settings width="20" height="20" aria-hidden="true" /></button>
        <button v-if="current" class="practice-icon-button" :disabled="busy || !!client.pending || !!error" :aria-label="active ? '暂停' : '继续'" :title="active ? '暂停 · Esc' : '继续 · Enter'" @click="active ? pause() : continueSession()"><Pause v-if="active" width="22" height="22" aria-hidden="true" /><Play v-else width="22" height="22" aria-hidden="true" /></button>
      </nav>
      <section v-if="settings" class="practice-settings" aria-label="听写设置面板">
        <div class="practice-settings-title"><strong>{{ view?.label }}</strong><button class="practice-icon-button" aria-label="关闭设置" @click="settings = false"><Xmark width="18" height="18" /></button></div>
        <p>{{ view?.available[mode] ?? 0 }} 个可用单词 · 已排除 {{ view?.available.excluded ?? 0 }} 个</p>
        <button :disabled="busy || !view || !!view.blocked || !!client.pending || !view.available[mode]" aria-label="开始新一轮" @click="ask('start')"><Restart width="16" height="16" aria-hidden="true" />开始新一轮</button>
        <button :disabled="busy || !!client.pending" @click="settings = false; pause(); startedLocally = undefined; load()">重新加载单词</button>
        <button :disabled="busy || !!client.pending || (!session && !view?.corrupt)" @click="ask('clear')">清除练习记录</button>
        <p class="practice-note">进度保存在当前设备，不改变单词的遗忘次数和复习日期。</p>
      </section>
    </header>
    <p v-if="themeError" class="practice-theme-error" role="alert">{{ themeError }}</p>
    <div class="practice-context">
      <span>{{ view?.owner === 'anonymous' ? '我的单词' : view?.label || '正在加载单词…' }} <span class="context-divider">/</span> {{ totalWords }} 个词</span>
      <span>{{ String(wordNumber).padStart(2, '0') }} / {{ String(totalWords).padStart(2, '0') }}<small v-if="current?.round"> · 重练 {{ current.round }}/2</small></span>
    </div>
    <div class="practice-progress" role="progressbar" aria-label="本轮进度" :aria-valuenow="summary?.answered ?? 0" :aria-valuemin="0" :aria-valuemax="totalWords || 1"><span v-for="n in totalWords" :key="n" :class="{ 'is-done': n <= (summary?.answered ?? 0) }"></span></div>
    <section class="practice-stage" :class="{ 'is-paused': !!current && paused, 'is-saving': busy, 'is-complete': session?.completed }" aria-label="听写区域" @click.self="focus">
      <div v-if="error || client.pending" class="practice-error" role="alert"><h2>连接已中断</h2><p>{{ error || '请先恢复上一次保存，再继续练习。' }}</p><button class="practice-button" :disabled="busy" @click="startedLocally = undefined; load(true)">重新连接并恢复</button></div>
      <template v-else-if="current">
        <div class="practice-prompt" :class="{ 'is-paused-prompt': paused }" :aria-hidden="paused || undefined">
          <div class="practice-word-line">
            <TypingInput :key="current.turnId + current.activationId" ref="input" v-model="answer" :target="current.word" :obscured="obscured" auto :disabled="!active" @submit="submit()" @complete="submit()" @mistake="typo" @assisted="assisted = true" @composing="composing = $event" />
            <PracticePronunciation v-if="current.word" :key="current.turnId + current.activationId" ref="speech" :word="current.word" :active="active" :disabled="!active" :obscured="obscured" @played="focus" />
          </div>
          <PracticeMeaning :word="current.word" :meaning="current.meaning || current.prompt" :source="current.source" :obscured="obscured" />
        </div>
        <div class="practice-stage-hint" role="status">
          <span v-if="busy">正在保存…</span>
          <button v-else-if="paused || !current.started" ref="resumeButton" class="continue-typing" @click="continueSession"><kbd>Enter</kbd> 继续练习</button>
          <span v-else-if="notice && !answer">{{ notice }}</span>
        </div>
        <div class="practice-word-actions">
          <button v-if="obscured" :disabled="!canSubmit" @click="reveal">显示提示</button>
          <button :disabled="!canSubmit" title="跳过 · Alt+Right" @click="submit(true)">跳过 <NavArrowRight width="14" height="14" aria-hidden="true" /></button>
        </div>
      </template>
      <template v-else>
        <h1 ref="completedHeading" class="practice-idle-title" tabindex="-1">{{ stageWord }}</h1>
        <p v-if="view?.blocked" class="practice-empty-note" role="status">{{ view.blocked }}</p>
        <template v-else-if="session?.completed">
          <p class="practice-empty-note">{{ summary?.total }} 个单词中，{{ summary?.firstCorrect }} 个一次写对。</p>
          <p class="practice-result-details">用时 {{ clock }} · 重练 {{ summary?.retryCorrect }} / {{ summary?.retries }} · 提示 {{ summary?.hinted }} · 辅助 {{ summary?.assisted }} · 中断 {{ summary?.interrupted }} · 跳过 {{ summary?.skipped }}</p>
          <p v-if="summary?.needsWork.length" class="practice-result-details">还需要巩固的单词</p>
          <ul v-if="summary?.needsWork.length" class="practice-difficult-words" aria-label="需要巩固的单词"><li v-for="word in summary.needsWork" :key="word.id">{{ word.word }}</li></ul>
          <div class="practice-end-actions"><button class="practice-button" :disabled="busy" @click="start()">再练一轮</button><button v-if="summary?.needsWork.length" class="practice-button secondary" :disabled="busy" @click="start(summary!.needsWork.map(w => w.id))">巩固易错词</button></div>
        </template>
        <template v-else-if="view?.available[mode]"><p class="practice-empty-note">{{ mode === 'copy' ? '听发音，照着单词输入。' : '听发音，在模糊字母上输入你的答案。' }}</p><button class="continue-typing start-typing" :disabled="busy" aria-label="开始新一轮" @click="start()"><kbd>Enter</kbd> 开始练习</button></template>
        <p v-else-if="view" class="practice-empty-note">阅读时保存单词，再来这里练习。</p>
      </template>
    </section>
    <footer class="practice-footer"><span><kbd>Alt</kbd> <kbd>P</kbd> 重听 <span class="footer-divider">·</span> <kbd>Esc</kbd> 暂停 <span class="footer-divider">·</span> <kbd>Alt</kbd> <kbd>→</kbd> 跳过</span><span v-if="session?.invalidated" role="status">已排除 {{ session.invalidated }} 个已更改或删除的单词</span><span v-else>单词听写</span></footer>
    <div v-if="confirm" class="practice-modal" @click.self="confirm = null"><section role="dialog" aria-modal="true" aria-labelledby="practice-confirm-title" @keydown.tab="trapDialog">
      <h2 id="practice-confirm-title">{{ confirm === 'clear' ? '清除练习记录？' : `开始${nextMode === 'copy' ? '看词跟写' : '模糊听写'}？` }}</h2><p>{{ confirm === 'clear' ? '将清除当前词库的练习进度。' : '这会替换尚未完成的练习。' }} 已保存的单词不受影响。</p>
      <div class="practice-end-actions"><button ref="cancelButton" class="practice-button secondary" @click="confirm = null">取消</button><button class="practice-button" @click="confirmAction">{{ confirm === 'clear' ? '清除记录' : '开始新一轮' }}</button></div>
    </section></div>
  </main>
</template>
