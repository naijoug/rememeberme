<script setup lang="ts">
import { computed } from 'vue';
import type { Translation } from '~/types';
import { isTranslation } from '~/services/definition-utils';
import { formatChineseTranslation } from '~/services/pinyin-format';
const props = defineProps<{ translation?: Translation }>();
const displayText = computed(() => isTranslation(props.translation) ? formatChineseTranslation(props.translation.text) : '');
</script>

<template>
  <div v-if="isTranslation(translation)" class="translation-section">
    <div class="translation-label">中文翻译</div>
    <p class="translation-text" lang="zh-CN">{{ displayText }}</p>
  </div>
</template>
