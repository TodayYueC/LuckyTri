<script setup lang="ts">
defineProps<{ title?: string; eyebrow?: string; sub?: string }>();
</script>

<template>
  <section class="card">
    <header v-if="title || eyebrow || $slots.actions" class="card-head">
      <div>
        <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="sub">{{ sub }}</p>
      </div>
      <div v-if="$slots.actions" class="row"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
