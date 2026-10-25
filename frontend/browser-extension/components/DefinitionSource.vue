<script setup lang="ts">
import type { Definition } from '~/types';
defineProps<{ source?: Definition['source'] }>();
</script>

<template>
  <p v-if="source === 'wordnet'" class="definition-source">Dictionary · <a href="https://wordnet.princeton.edu/" target="_blank" rel="noopener noreferrer">WordNet</a></p>
  <p v-else-if="source === 'dictionary-api'" class="definition-source">Online dictionary · <a href="https://dictionaryapi.dev/" target="_blank" rel="noopener noreferrer">Free Dictionary</a></p>
</template>
