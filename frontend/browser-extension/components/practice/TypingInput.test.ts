import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import TypingInput from './TypingInput.vue';
let cleanup: () => void;
afterEach(() => cleanup?.());
it('does not submit IME confirmation or repeated Enter; preserves text edits and marks pasted input', async () => {
  let submitted = 0, assisted = 0; const value = ref('');
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(TypingInput, { modelValue: value.value, disabled: false,
    'onUpdate:modelValue': (v: string) => { value.value = v; }, onSubmit: () => submitted++, onAssisted: () => assisted++ }) });
  app.mount(root); cleanup = () => { app.unmount(); root.remove(); };
  const input = root.querySelector('input')!;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const imeEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input.dispatchEvent(imeEnter); expect(submitted).toBe(0); expect(imeEnter.defaultPrevented).toBe(false);
  input.value = "can't"; input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  expect(value.value).toBe("can't"); await nextTick();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })); expect(submitted).toBe(0);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); expect(submitted).toBe(0);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(submitted).toBe(1);
  input.dispatchEvent(new Event('paste', { bubbles: true })); expect(assisted).toBe(1);
  input.value = 'can'; input.dispatchEvent(new Event('input', { bubbles: true })); expect(value.value).toBe('can');
  await nextTick(); expect(root.querySelector('.practice-letters')).toBeNull();
  expect(input.autocomplete).toBe('off'); expect(input.getAttribute('spellcheck')).toBe('false');
});

it('keeps typed characters sharp and literal over a frosted reference without accessible answer hints', async () => {
  const value = ref(''), obscured = ref(true), disabled = ref(false);
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(TypingInput, { modelValue: value.value, target: 'humble', obscured: obscured.value, disabled: disabled.value,
    'onUpdate:modelValue': (v: string) => { value.value = v; } }) });
  app.mount(root); cleanup = () => { app.unmount(); root.remove(); };
  const input = root.querySelector('input')!;
  input.value = 'h'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  expect(root.querySelectorAll('.typing-letter')).toHaveLength(6);
  expect(root.querySelector('.letter-entered')?.textContent).toBe('h');
  expect(root.querySelector('.letter-entered')?.classList.contains('is-frosted')).toBe(false);
  expect(root.querySelectorAll('.letter-reference.is-frosted:not(.is-covered)')).toHaveLength(5);
  expect(root.querySelector('#practice-target')).toBeNull();
  expect(input.getAttribute('aria-describedby')).toBe('practice-input-help');
  input.value = '<img>'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  expect(root.querySelector('img')).toBeNull(); expect(root.querySelectorAll('.letter-wrong')).toHaveLength(4);
  obscured.value = false; await nextTick(); expect(root.querySelector('#practice-target')?.textContent).toContain('humble');
  disabled.value = true; await nextTick(); expect(root.querySelector('.letter-cursor')).toBeNull();
});
