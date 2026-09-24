<script setup lang="ts">
defineProps<{ label: string; hint?: string; wide?: boolean }>();
</script>

<template>
  <label :class="{ wide }">
    <span>{{ label }}</span>
    <slot />
    <small v-if="hint">{{ hint }}</small>
  </label>
</template>
