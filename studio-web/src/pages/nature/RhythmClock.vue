<script setup lang="ts">
import { computed, ref } from "vue";

const sleep = defineModel<string>("sleep", { required: true });
const wake = defineModel<string>("wake", { required: true });
defineProps<{ disabled?: boolean }>();

const C = 110;
const R = 84;
const svg = ref<SVGSVGElement>();
let dragging: "sleep" | "wake" | null = null;

const minutes = (value: string) => {
  const [h, m] = String(value || "00:00")
    .split(":")
    .map(Number);
  return (h * 60 + m) % 1440;
};
const clock = (value: number) => {
  const m = (((Math.round(value / 15) * 15) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const angle = (m: number) => (m / 1440) * Math.PI * 2 - Math.PI / 2;
const point = (m: number, r = R) => ({
  x: C + Math.cos(angle(m)) * r,
  y: C + Math.sin(angle(m)) * r,
});

function arc(from: number, to: number) {
  const span = (to - from + 1440) % 1440 || 1440;
  const a = point(from);
  const b = point(to);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)}A${R},${R} 0 ${span > 720 ? 1 : 0} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

const s = computed(() => minutes(sleep.value));
const w = computed(() => minutes(wake.value));
const hours = computed(() => {
  const span = (w.value - s.value + 1440) % 1440;
  return `${Math.floor(span / 60)} 小时${span % 60 ? ` ${span % 60} 分` : ""}`;
});

function fromPointer(event: PointerEvent) {
  const box = svg.value!.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * 220 - C;
  const y = ((event.clientY - box.top) / box.height) * 220 - C;
  const a = Math.atan2(y, x) + Math.PI / 2;
  return clock(((((a / (Math.PI * 2)) * 1440) % 1440) + 1440) % 1440);
}

function start(which: "sleep" | "wake", event: PointerEvent) {
  dragging = which;
  (event.target as Element).setPointerCapture?.(event.pointerId);
}
function move(event: PointerEvent) {
  if (!dragging) return;
  const next = fromPointer(event);
  const other = dragging === "sleep" ? wake.value : sleep.value;
  if (next === other) return;
  if (dragging === "sleep") sleep.value = next;
  else wake.value = next;
}
function end() {
  dragging = null;
}
function key(which: "sleep" | "wake", event: KeyboardEvent) {
  const step = {
    ArrowRight: 15,
    ArrowUp: 15,
    ArrowLeft: -15,
    ArrowDown: -15,
    PageUp: 60,
    PageDown: -60,
  }[event.key];
  if (!step) return;
  event.preventDefault();
  const current = minutes(which === "sleep" ? sleep.value : wake.value);
  const next = clock(current + step);
  if (next === (which === "sleep" ? wake.value : sleep.value)) return;
  if (which === "sleep") sleep.value = next;
  else wake.value = next;
}
</script>

<template>
  <div class="rhythm" :class="{ disabled }">
    <svg
      ref="svg"
      viewBox="0 0 220 220"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="end"
    >
      <defs>
        <linearGradient id="clock-awake" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff1b8" />
          <stop offset=".48" stop-color="#ffd8b8" />
          <stop offset="1" stop-color="#b8e8ff" />
        </linearGradient>
        <linearGradient id="clock-asleep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#a6bfff" />
          <stop offset=".55" stop-color="#b9b5f1" />
          <stop offset="1" stop-color="#d6c5ff" />
        </linearGradient>
        <radialGradient id="clock-center">
          <stop offset="0" stop-color="white" stop-opacity=".82" />
          <stop offset=".7" stop-color="white" stop-opacity=".35" />
          <stop offset="1" stop-color="white" stop-opacity=".04" />
        </radialGradient>
      </defs>
      <circle class="glass-center" :cx="C" :cy="C" r="68" />
      <circle class="track" :cx="C" :cy="C" :r="R" />
      <path class="awake" :d="arc(w, s)" />
      <path class="asleep" :d="arc(s, w)" />
      <g class="ticks">
        <text
          v-for="h in [0, 6, 12, 18]"
          :key="h"
          :x="point(h * 60, R - 30).x"
          :y="point(h * 60, R - 30).y + 4"
          text-anchor="middle"
        >
          {{ h }}
        </text>
      </g>
      <text class="center big" :x="C" :y="C - 4" text-anchor="middle">
        睡 {{ hours }}
      </text>
      <text class="center" :x="C" :y="C + 16" text-anchor="middle">
        {{ sleep }} → {{ wake }}
      </text>
      <g
        class="handle moon"
        role="slider"
        tabindex="0"
        aria-label="几点睡"
        :aria-valuetext="sleep"
        @pointerdown="start('sleep', $event)"
        @keydown="key('sleep', $event)"
      >
        <circle :cx="point(s).x" :cy="point(s).y" r="15" />
        <text :x="point(s).x" :y="point(s).y + 5" text-anchor="middle">☾</text>
      </g>
      <g
        class="handle sun"
        role="slider"
        tabindex="0"
        aria-label="几点醒"
        :aria-valuetext="wake"
        @pointerdown="start('wake', $event)"
        @keydown="key('wake', $event)"
      >
        <circle :cx="point(w).x" :cy="point(w).y" r="15" />
        <text :x="point(w).x" :y="point(w).y + 5" text-anchor="middle">☀</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.rhythm {
  width: 220px;
  max-width: 100%;
  touch-action: none;
  padding: 7px;
  border: 1px solid rgb(255 255 255 / 0.8);
  border-radius: 50%;
  background:
    radial-gradient(circle at 25% 20%, rgb(255 255 255 / 0.9), transparent 37%),
    color-mix(in srgb, var(--glow-b) 15%, rgb(255 255 255 / 0.4));
  box-shadow:
    inset 0 1px 0 white,
    0 16px 32px -24px color-mix(in srgb, var(--accent) 50%, transparent);
  backdrop-filter: blur(18px) saturate(1.5);
  transition:
    transform 0.55s var(--spring),
    box-shadow 0.35s;
}
.rhythm:hover:not(.disabled) {
  transform: scale(1.035) rotate(-1deg);
  box-shadow:
    inset 0 1px 0 white,
    0 18px 36px -19px color-mix(in srgb, var(--accent) 46%, transparent);
}
.rhythm.disabled {
  opacity: 0.45;
  pointer-events: none;
}
svg {
  width: 100%;
  height: auto;
}
.glass-center {
  fill: url(#clock-center);
  stroke: rgb(255 255 255 / 0.75);
  stroke-width: 1;
}
.track {
  fill: none;
  stroke: rgb(255 255 255 / 0.65);
  stroke-width: 20;
}
.awake {
  fill: none;
  stroke: url(#clock-awake);
  stroke-width: 16;
  stroke-linecap: round;
  filter: drop-shadow(0 2px 3px rgb(217 147 108 / 0.18));
}
.asleep {
  fill: none;
  stroke: url(#clock-asleep);
  stroke-width: 16;
  stroke-linecap: round;
  filter: drop-shadow(0 2px 3px rgb(100 113 204 / 0.17));
}
.ticks text {
  fill: var(--ink-soft);
  font-size: 11px;
}
.center {
  fill: var(--ink-soft);
  font-size: 12px;
}
.center.big {
  fill: var(--ink);
  font: 700 15px var(--font-display);
}
.handle {
  cursor: grab;
  outline: none;
}
.handle circle {
  fill: rgb(255 255 255 / 0.88);
  stroke: #9baeed;
  stroke-width: 2;
  filter: drop-shadow(0 3px 4px rgb(73 94 168 / 0.24));
  transition: r 0.28s var(--spring);
}
.handle.sun circle {
  stroke: #efbe8a;
}
.handle text {
  font-size: 15px;
  fill: #4b54b3;
  pointer-events: none;
}
.handle.sun text {
  fill: #e0892a;
}
.handle:hover circle {
  r: 18;
}
.handle:focus-visible circle {
  stroke-width: 5;
}
</style>
