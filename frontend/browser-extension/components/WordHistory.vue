<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { HistoryRecord } from '~/types';
import HistoryItem from './HistoryItem.vue';

const props = withDefaults(defineProps<{ word: string; history: HistoryRecord[]; heading?: boolean }>(), { heading: true });
const visibleCount = ref(10);
watch(() => props.word, () => { visibleCount.value = 10; });
const records = computed(() => props.history.map((record, index) => ({ record, number: index + 1 })).reverse().slice(0, visibleCount.value));
</script>

<template>
  <section class="history-section" aria-label="Word history">
    <h3 v-if="heading !== false" class="section-title">Records <span>· {{ history.length }}</span></h3>
    <HistoryItem v-for="item in records" :key="item.record.timestamp + ':' + item.number" :record="item.record" :word="word" :record-number="item.number" :show-definition="true" />
    <p v-if="!history.length" class="context-text">No records yet. Click the bookmark counter to save this encounter.</p>
    <button v-if="visibleCount < history.length" class="rm-text-action" @click="visibleCount += 10">Show more records</button>
  </section>
</template>
