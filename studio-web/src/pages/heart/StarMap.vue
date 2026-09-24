<script setup lang="ts">
import { computed } from "vue";
import { KIND_COLORS } from "../../plates/mind";
import { hueOf } from "../../format";
import { liveMood } from "../../mood/useMood";
import TaOrb from "../../components/ta/TaOrb.vue";

const props = defineProps<{
  threads: any[];
  kinds: Record<string, string>;
  activity?: string;
}>();
const emit = defineEmits<{ open: [thread: any] }>();

const W = 1000;
const H = 560;
const CX = W / 2;
const CY = H / 2;

function unit(value: string) {
  return hueOf(value) / 360;
}

// A few hundred fixed background stars, the same every visit.
const dust = Array.from({ length: 90 }, (_, i) => ({
  x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
  y: (Math.sin(i * 78.233) * 12543.123) % 1,
  r: 0.5 + (i % 5) * 0.25,
})).map((s) => ({
  x: Math.abs(s.x) * W,
  y: Math.abs(s.y) * H,
  r: s.r,
  d: (s.x * 7) % 4,
}));

const kindOrder = computed(() =>
  Object.keys(props.kinds).filter((k) =>
    props.threads.some((t) => t.kind === k),
  ),
);

const stars = computed(() => {
  const order = kindOrder.value;
  const sector = (Math.PI * 2) / Math.max(1, order.length);
  return props.threads.map((t) => {
    const i = Math.max(0, order.indexOf(t.kind));
    const angle =
      -Math.PI / 2 + i * sector + (unit(t.thread) - 0.5) * sector * 0.72;
    const salience = t.salience ?? 0.5;
    const radius = t.faded
      ? 238 + unit(t.thread + "far") * 26
      : 92 + (1 - salience) * 138;
    return {
      ...t,
      x: CX + Math.cos(angle) * radius,
      y: CY + Math.sin(angle) * radius * 0.82,
      size: 4.5 + (t.strength || 0) * 9,
      glow: t.faded ? 0.32 : 0.45 + salience * 0.55,
      color: KIND_COLORS[t.kind] || "#ffffff",
      label: t.content.length > 12 ? t.content.slice(0, 12) + "…" : t.content,
    };
  });
});

const labelled = computed(() => {
  const near = stars.value.filter((s) => !s.faded);
  const top = [...near]
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, 8);
  return new Set(top.map((s) => s.thread));
});

const lines = computed(() => {
  const out: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
  }[] = [];
  for (const kind of kindOrder.value) {
    const group = stars.value
      .filter((s) => s.kind === kind && !s.faded)
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
    for (let i = 1; i < group.length; i++)
      out.push({
        x1: group[i - 1].x,
        y1: group[i - 1].y,
        x2: group[i].x,
        y2: group[i].y,
        color: group[i].color,
      });
  }
  return out;
});

function open(event: KeyboardEvent | MouseEvent, star: any) {
  if (
    event instanceof KeyboardEvent &&
    event.key !== "Enter" &&
    event.key !== " "
  )
    return;
  event.preventDefault();
  emit("open", star);
}
</script>

<template>
  <div class="starmap">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="sky-svg"
      role="group"
      aria-label="心灵星图：每条自我线索是一颗星"
    >
      <defs>
        <filter id="star-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <circle
        v-for="(s, i) in dust"
        :key="i"
        class="dust"
        :cx="s.x"
        :cy="s.y"
        :r="s.r"
        :style="{ animationDelay: s.d + 's' }"
      />
      <ellipse class="far-ring" :cx="CX" :cy="CY" rx="252" :ry="252 * 0.82" />
      <text
        class="far-label"
        :x="CX"
        :y="CY - 252 * 0.82 - 10"
        text-anchor="middle"
      >
        远方 · 很久没被触及的
      </text>
      <line
        v-for="(l, i) in lines"
        :key="'l' + i"
        class="bond"
        :x1="l.x1"
        :y1="l.y1"
        :x2="l.x2"
        :y2="l.y2"
        :style="{ stroke: l.color }"
      />
      <g
        v-for="s in stars"
        :key="s.thread"
        class="star"
        :class="{ faded: s.faded, core: s.core }"
        :data-thread="s.thread"
        role="button"
        tabindex="0"
        :aria-label="`${kinds[s.kind] || s.kind}：${s.content}`"
        :style="{ '--c': s.color, opacity: s.glow }"
        @click="open($event, s)"
        @keydown="open($event, s)"
      >
        <circle
          class="halo-glow"
          :cx="s.x"
          :cy="s.y"
          :r="s.size * 1.9"
          filter="url(#star-glow)"
        />
        <circle
          v-if="s.core"
          class="core-ring"
          :cx="s.x"
          :cy="s.y"
          :r="s.size + 7"
        />
        <circle class="body" :cx="s.x" :cy="s.y" :r="s.size" />
        <circle class="hit" :cx="s.x" :cy="s.y" :r="Math.max(16, s.size + 8)" />
        <text
          v-if="labelled.has(s.thread)"
          class="label"
          :x="s.x"
          :y="s.y + s.size + 16"
          text-anchor="middle"
        >
          {{ s.label }}
        </text>
      </g>
    </svg>
    <div class="center" aria-hidden="true">
      <TaOrb :mood="liveMood" :activity="activity || 'idle'" :size="84" />
    </div>
    <ul class="legend">
      <li v-for="k in kindOrder" :key="k">
        <i :style="{ background: KIND_COLORS[k] }"></i>{{ kinds[k] }} ·
        {{ threads.filter((t) => t.kind === k).length }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.starmap {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-l);
  background: radial-gradient(
    ellipse at 50% 50%,
    color-mix(in srgb, var(--accent) 30%, #141a44),
    #070b22 72%
  );
  box-shadow: var(--shadow);
}
.sky-svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 560px;
}
.dust {
  fill: #ffffff;
  opacity: 0.5;
  animation: twinkle 4s ease-in-out infinite;
}
.far-ring {
  fill: none;
  stroke: rgb(255 255 255 / 0.12);
  stroke-dasharray: 4 10;
}
.far-label {
  fill: rgb(255 255 255 / 0.45);
  font-size: 13px;
  letter-spacing: 0.12em;
}
.bond {
  stroke-width: 1.2;
  opacity: 0.28;
}
.star {
  cursor: pointer;
  outline: none;
  transition: opacity 0.4s;
}
.star .body {
  fill: var(--c);
  stroke: rgb(255 255 255 / 0.85);
  stroke-width: 1.5;
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 0.3s var(--spring);
}
.star .halo-glow {
  fill: var(--c);
  opacity: 0.55;
}
.star .core-ring {
  fill: none;
  stroke: var(--c);
  stroke-width: 1.5;
  stroke-dasharray: 3 4;
  transform-box: fill-box;
  transform-origin: center;
  animation: spin 18s linear infinite;
}
.star .hit {
  fill: transparent;
}
.star .label {
  fill: rgb(255 255 255 / 0.85);
  font-size: 13px;
  pointer-events: none;
}
.star:hover .body,
.star:focus-visible .body {
  transform: scale(1.35);
}
.star:focus-visible .hit {
  stroke: #ffffff;
  stroke-width: 2;
  stroke-dasharray: 3 3;
}
.star.faded .body {
  stroke-opacity: 0.4;
}
.center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -54%);
  pointer-events: none;
}
.legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: rgb(255 255 255 / 0.8);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.15;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 760px) {
  .legend {
    position: static;
    padding: 10px 14px 14px;
  }
  .center :deep(.ta-orb) {
    width: 56px !important;
    height: 56px !important;
  }
}
</style>
