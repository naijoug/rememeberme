<script setup lang="ts">
import { useId } from 'vue';
defineProps<{ accent: 'US' | 'UK' }>();
const diagonalClip = useId();
</script>

<template>
  <svg class="pronunciation-flag" :viewBox="accent === 'US' ? '0 0 190 100' : '0 0 60 30'" role="img"
    :aria-label="accent === 'US' ? 'United States flag' : 'United Kingdom flag'">
    <title>{{ accent === 'US' ? 'American pronunciation' : 'British pronunciation' }}</title>
    <template v-if="accent === 'US'">
      <rect width="190" height="100" fill="#fff" />
      <rect v-for="row in 7" :key="row" x="0" :y="(row - 1) * 200 / 13" width="190" :height="100 / 13" fill="#b22234" />
      <rect width="76" :height="700 / 13" fill="#3c3b6e" />
      <g fill="#fff">
        <g v-for="row in 9" :key="row">
          <path v-for="column in row % 2 ? 6 : 5" :key="column"
            d="M0 -1 .2245 -.309 .9511 -.309 .3633 .118 .5878 .809 0 .382 -.5878 .809 -.3633 .118 -.9511 -.309 -.2245 -.309Z"
            :transform="`translate(${(column * 2 - (row % 2 ? 1 : 0)) * 76 / 12} ${row * 700 / 130}) scale(3.08)`" />
        </g>
      </g>
    </template>
    <template v-else>
      <defs><clipPath :id="diagonalClip"><path d="M30 15H60V30ZM30 15V30H0ZM30 15H0V0ZM30 15V0H60Z" /></clipPath></defs>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6" />
      <path d="M0 0 60 30M60 0 0 30" stroke="#c8102e" stroke-width="4" :clip-path="`url(#${diagonalClip})`" />
      <path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10" />
      <path d="M30 0V30M0 15H60" stroke="#c8102e" stroke-width="6" />
    </template>
  </svg>
</template>
