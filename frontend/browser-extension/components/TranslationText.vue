<script setup lang="ts">
import type { Translation } from '~/types';
import { isTranslation } from '~/services/definition-utils';
defineProps<{ translation?: Translation }>();
</script>

<template>
  <div v-if="isTranslation(translation)" class="translation-section">
    <div class="translation-label">中文翻译</div>
    <p class="translation-text" lang="zh-CN">{{ translation.text }}</p>
    <p class="definition-source">Online translation · <a href="https://mymemory.translated.net/" target="_blank" rel="noopener noreferrer">MyMemory</a></p>
  </div>
</template>
