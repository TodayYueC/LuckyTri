<script setup lang="ts">
const model = defineModel<boolean>({ default: false });
defineProps<{ name?: string; disabled?: boolean }>();
</script>

<template>
  <label class="switch">
    <input v-model="model" type="checkbox" :name="name" :disabled="disabled" />
    <span><slot /></span>
  </label>
</template>
