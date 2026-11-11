<script setup lang="ts">
import { computed } from 'vue';
import { dictionaryCategories } from '~/services/dictionary-categories';
const props = defineProps<{ word: string }>();
const categories = computed(() => dictionaryCategories.forWord(props.word));
</script>

<template>
  <div v-if="categories.length" class="dictionary-categories" aria-label="Word lists">
    <span v-for="item in categories" :key="item.category" class="dictionary-category">{{ item.label }}</span>
  </div>
</template>
