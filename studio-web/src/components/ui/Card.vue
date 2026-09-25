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

<style scoped>
.card-head {
  position: relative;
  align-items: center;
  margin-bottom: 19px;
  padding-bottom: 13px;
  border-bottom: 1px solid rgb(255 255 255 / 0.7);
}
.card-head h2 {
  margin-top: 3px;
  font-size: clamp(18px, 1.7vw, 22px);
  font-weight: 740;
  letter-spacing: -0.025em;
}
.card-head p {
  margin-top: 5px;
  line-height: 1.55;
}
.card-head .eyebrow {
  color: var(--accent);
}
</style>
