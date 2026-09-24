<script setup lang="ts">
defineProps<{ title: string; text?: string }>();
</script>

<template>
  <div class="empty">
    <span class="empty-blob" aria-hidden="true"><i></i><i></i></span>
    <b>{{ title }}</b>
    <span v-if="text">{{ text }}</span>
    <slot />
  </div>
</template>

<style scoped>
.empty-blob {
  position: relative;
  display: block;
  width: 44px;
  height: 38px;
  margin-bottom: 4px;
  border-radius: 50% 50% 46% 46%;
  background: radial-gradient(
    circle at 38% 30%,
    var(--orb-a),
    var(--orb-b) 60%,
    var(--orb-c)
  );
  opacity: 0.85;
  animation: float-y 2.8s ease-in-out infinite alternate;
}
.empty-blob i {
  position: absolute;
  top: 16px;
  width: 7px;
  height: 3px;
  border-radius: 0 0 6px 6px;
  border: 2px solid var(--orb-face);
  border-top: none;
}
.empty-blob i:first-child {
  left: 12px;
}
.empty-blob i:last-child {
  right: 12px;
}
</style>
