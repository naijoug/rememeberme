<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { TranslationCache } from '~/services/translation-cache';
import { formatChineseTranslation } from '~/services/pinyin-format';
const props = defineProps<{ word?: string; meaning: string; source: string }>();
const cached = ref(''), cachedSource = ref(''), cache = new TranslationCache(undefined, undefined, undefined, 2000);
watch(() => [props.word, props.meaning, props.source], async (_, _old, cleanup) => {
  let cancelled = false; cleanup(() => { cancelled = true; }); cached.value = ''; cachedSource.value = '';
  if (!props.word || ['magpie', 'hermes', 'mymemory'].includes(props.source)) return;
  let entry = await cache.get(props.word.toLowerCase());
  // One more bounded local read can pick up a just-finished legacy migration.
  if (!entry && !cancelled) entry = await cache.get(props.word.toLowerCase());
  if (!cancelled && entry) { cached.value = entry.translation.text; cachedSource.value = entry.translation.source ?? ''; }
}, { immediate: true });
const full = computed(() => formatChineseTranslation(cached.value || props.meaning));
const brief = computed(() => full.value.length > 180 ? full.value.slice(0, 177) + '…' : full.value);
onUnmounted(() => { void cache.close(); });
</script>
<template>
  <p class="practice-meaning" :title="`${cached ? 'Cached Chinese meaning' : 'Saved meaning'} · ${cached ? cachedSource : source}\n${full || 'No saved meaning'}`">{{ brief || 'No meaning saved for this word' }}</p>
</template>
