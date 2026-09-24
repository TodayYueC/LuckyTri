<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ORIGIN_LABELS } from "../../plates/mind";
import { clockTime } from "../../format";

const props = defineProps<{
  moods: any[];
  baseline?: number;
  timeZone?: string;
}>();

const H = 150;
const MID = H / 2;
const AMP = 58;
const box = ref<HTMLElement>();
const W = ref(1000);
let observer: ResizeObserver | null = null;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    W.value = Math.max(240, Math.round(entry.contentRect.width));
  });
  if (box.value) observer.observe(box.value);
});
onBeforeUnmount(() => observer?.disconnect());

const points = computed(() => {
  const list = [...props.moods].sort((a, b) => a.created - b.created);
  const step = list.length > 1 ? (W.value - 60) / (list.length - 1) : 0;
  return list.map((m, i) => ({
    ...m,
    x: 30 + i * step,
    y: MID - Math.max(-1, Math.min(1, m.valence)) * AMP,
  }));
});

const path = computed(() => {
  const p = points.value;
  if (p.length < 2) return "";
  let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    d += `C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
});
const area = computed(() => {
  const p = points.value;
  return path.value
    ? `${path.value}L${p[p.length - 1].x},${H}L${p[0].x},${H}Z`
    : "";
});
const base = computed(() => MID - (props.baseline ?? 0.15) * AMP);
const recent = computed(() => [...props.moods].slice(0, 6));
</script>

<template>
  <section class="card ribbon">
    <div class="card-head">
      <div>
        <span class="eyebrow">MOOD RIBBON</span>
        <h2>心情是怎样起伏的</h2>
        <p>最近 {{ moods.length }} 次被经历牵动；之后都会慢慢回到平常。</p>
      </div>
    </div>
    <div ref="box" class="ribbon-box">
      <svg
        v-if="path"
        class="ribbon-chart"
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        aria-label="最近的心情曲线"
      >
        <defs>
          <linearGradient
            id="ribbon-stroke"
            x1="0"
            y1="0"
            x2="0"
            :y2="H"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" style="stop-color: var(--cheek)" />
            <stop offset="50%" style="stop-color: var(--accent)" />
            <stop offset="100%" style="stop-color: var(--orb-c)" />
          </linearGradient>
          <linearGradient id="ribbon-fill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              style="stop-color: var(--accent); stop-opacity: 0.22"
            />
            <stop
              offset="100%"
              style="stop-color: var(--accent); stop-opacity: 0"
            />
          </linearGradient>
        </defs>
        <line class="base" x1="0" :x2="W" :y1="base" :y2="base" />
        <path class="area" :d="area" />
        <path class="line" :d="path" />
        <g
          v-for="p in points"
          :key="p.id"
          class="pt"
          :class="p.valence >= 0 ? 'warm' : 'cool'"
        >
          <circle :cx="p.x" :cy="p.y" :r="4 + p.intensity * 6">
            <title>
              {{ clockTime(p.created, timeZone) }} {{ p.feeling }}：{{
                p.cause || "说不清为什么"
              }}
            </title>
          </circle>
        </g>
      </svg>
      <p v-else class="muted empty-line">
        心情还没有被什么事牵动过。每一次经历都可能推动 TA
        的心情，随后又会慢慢回到平常。
      </p>
    </div>
    <ul v-if="recent.length" class="recent">
      <li
        v-for="m in recent"
        :key="m.id"
        :class="m.valence >= 0 ? 'warm' : 'cool'"
      >
        <b>{{ m.feeling }}</b>
        <span>{{ m.cause || "说不清为什么" }}</span>
        <small
          >{{ clockTime(m.created, timeZone) }} ·
          {{ ORIGIN_LABELS[m.origin] || m.origin }}</small
        >
      </li>
    </ul>
  </section>
</template>

<style scoped>
.ribbon-box {
  min-width: 0;
}
.ribbon-chart {
  width: 100%;
  height: 150px;
  overflow: visible;
}
.base {
  stroke: var(--ink-faint);
  stroke-width: 1;
  stroke-dasharray: 5 7;
}
.area {
  fill: url(#ribbon-fill);
}
.line {
  fill: none;
  stroke: url(#ribbon-stroke);
  stroke-width: 3.5;
  stroke-linecap: round;
}
.pt circle {
  stroke: var(--surface-strong);
  stroke-width: 2;
}
.pt.warm circle {
  fill: var(--cheek);
}
.pt.cool circle {
  fill: var(--orb-c);
}
.empty-line {
  font-size: 13px;
}
.recent {
  display: flex;
  gap: 10px;
  margin: 14px 0 0;
  padding: 0 0 4px;
  list-style: none;
  overflow-x: auto;
}
.recent li {
  display: grid;
  flex: 0 0 auto;
  width: 190px;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
  border: 1px solid var(--line);
  border-left: 4px solid var(--orb-c);
}
.recent li.warm {
  border-left-color: var(--cheek);
}
.recent b {
  font-size: 14px;
}
.recent span {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent small {
  color: var(--ink-soft);
  font-size: 11.5px;
}
</style>
