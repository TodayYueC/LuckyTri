<script setup lang="ts">
const model = defineModel<string>({ required: true });
defineProps<{
  items: { key: string; label: string; count?: number | string }[];
  label: string;
}>();

function move(event: KeyboardEvent, items: { key: string }[]) {
  const index = items.findIndex((item) => item.key === model.value);
  const step =
    event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const next = items[(index + step + items.length) % items.length];
  model.value = next.key;
  const bar = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
  requestAnimationFrame(() =>
    bar?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus(),
  );
}
</script>

<template>
  <div class="seg tabs" role="tablist" :aria-label="label">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="tab"
      :data-tab="item.key"
      :aria-selected="model === item.key"
      :tabindex="model === item.key ? 0 : -1"
      @click="model = item.key"
      @keydown="move($event, items)"
    >
      {{ item.label
      }}<small
        v-if="item.count !== undefined && item.count !== ''"
        class="count"
        >{{ item.count }}</small
      >
    </button>
  </div>
</template>

<style scoped>
.count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
</style>
