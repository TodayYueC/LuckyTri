<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  value: number;
  text?: string;
  warn?: boolean;
}>();
const percent = computed(() =>
  Math.round(Math.max(0, Math.min(1, Number(props.value) || 0)) * 100),
);
</script>

<template>
  <div class="meter-row">
    <span class="meter-label">{{ label }}</span>
    <div
      class="meter"
      :class="{ warn }"
      role="meter"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
    >
      <i :style="{ width: percent + '%' }"></i>
    </div>
    <b class="meter-value">{{ text ?? percent + "%" }}</b>
  </div>
</template>

<style scoped>
.meter-row {
  display: grid;
  grid-template-columns: minmax(64px, max-content) 1fr minmax(
      40px,
      max-content
    );
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
}
.meter-label {
  color: var(--ink-soft);
}
.meter-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
