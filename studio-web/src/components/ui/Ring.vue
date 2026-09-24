<script setup lang="ts">
import { computed } from "vue";

// A small dial: 0..1, or -1..1 when `signed` (the arc then grows either way
// from the top).
const props = withDefaults(
  defineProps<{
    value: number;
    label: string;
    caption?: string;
    signed?: boolean;
    size?: number;
  }>(),
  { signed: false, size: 64, caption: "" },
);
const C = 2 * Math.PI * 18;
const clamped = computed(() => {
  const v = Number(props.value) || 0;
  return props.signed
    ? Math.max(-1, Math.min(1, v))
    : Math.max(0, Math.min(1, v));
});
const arc = computed(() => Math.abs(clamped.value) * C);
const negative = computed(() => clamped.value < 0);
</script>

<template>
  <figure class="ring" :style="{ width: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 44 44" aria-hidden="true">
      <circle class="track" cx="22" cy="22" r="18" />
      <circle
        class="arc"
        :class="{ negative }"
        cx="22"
        cy="22"
        r="18"
        :stroke-dasharray="`${arc.toFixed(2)} ${C.toFixed(2)}`"
        :transform="
          negative
            ? 'translate(44 0) scale(-1 1) rotate(-90 22 22)'
            : 'rotate(-90 22 22)'
        "
      />
      <text x="22" y="25.5" text-anchor="middle">
        {{ Math.round(clamped * 100) }}
      </text>
    </svg>
    <figcaption>
      <b>{{ label }}</b>
      <small v-if="caption">{{ caption }}</small>
    </figcaption>
  </figure>
</template>

<style scoped>
.ring {
  display: grid;
  justify-items: center;
  gap: 6px;
  margin: 0;
  text-align: center;
}
.track {
  fill: none;
  stroke: color-mix(in srgb, var(--ink) 10%, transparent);
  stroke-width: 4.5;
}
.arc {
  fill: none;
  stroke: var(--accent);
  stroke-width: 4.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.8s var(--ease);
}
.arc.negative {
  stroke: var(--danger);
}
text {
  font: 700 10px var(--font-display);
  fill: var(--ink);
}
figcaption {
  display: grid;
  font-size: 12px;
  line-height: 1.35;
}
figcaption small {
  color: var(--ink-soft);
  font-size: 11px;
}
</style>
