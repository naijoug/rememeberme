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
