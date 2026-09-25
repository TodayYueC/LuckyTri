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
const latest = computed(() => recent.value[0]);
</script>

<template>
  <section class="ribbon">
    <div class="ribbon-head">
      <div class="ribbon-title">
        <span class="eyebrow">MOOD / 此刻的天气</span>
        <h2>心情有自己的潮汐。</h2>
        <p>最近 {{ moods.length }} 次被经历牵动；有起伏，也会慢慢平静。</p>
      </div>
      <div v-if="latest" class="latest-mood">
        <span>刚刚留下的心情</span>
        <b>{{ latest.feeling }}</b>
        <small>{{ latest.cause || "暂时说不清缘由" }}</small>
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
        <path class="line-glow" :d="path" />
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
    <ul v-if="recent.length" class="recent" aria-label="最近的心情">
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
.ribbon {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 25px 28px 20px;
  border: 1px solid #ffffffe8;
  border-radius: 36px;
  background: linear-gradient(120deg, #ffffffd3, #e5f4ff85 55%, #fae9f682);
  box-shadow:
    inset 0 2px 0 #fff,
    0 26px 52px -39px #6889c492;
  backdrop-filter: blur(25px) saturate(1.65);
  -webkit-backdrop-filter: blur(25px) saturate(1.65);
}
.ribbon::before {
  content: "";
  position: absolute;
  z-index: -1;
  right: -100px;
  top: -170px;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: conic-gradient(#b9d9ff99, #fff1d9a3, #f5ccf385, #b9d9ff99);
  filter: blur(31px);
  animation: ribbon-drift 12s ease-in-out infinite alternate;
}
.ribbon-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 24px;
}
.ribbon-title h2 {
  margin: 9px 0 6px;
  font-size: clamp(22px, 2.5vw, 32px);
  letter-spacing: -0.035em;
}
.ribbon-title p {
  font-size: 12px;
  color: var(--ink-soft);
}
.latest-mood {
  display: grid;
  flex: 0 0 225px;
  gap: 2px;
  max-width: 225px;
  padding: 11px 16px;
  border-radius: 20px;
  border: 1px solid #fff;
  background: #ffffff85;
  box-shadow:
    inset 0 1px 0 #fff,
    0 12px 26px -21px #6280b0;
  backdrop-filter: blur(14px);
}
.latest-mood span {
  font-size: 10px;
  color: var(--ink-soft);
}
.latest-mood b {
  font-size: 17px;
}
.latest-mood small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-soft);
  font-size: 11px;
}
.ribbon-box {
  min-width: 0;
  margin-top: 18px;
  border-radius: 19px;
  background: linear-gradient(180deg, #ffffff5b, #ffffff15);
  border: 1px solid #ffffff9d;
  box-shadow: inset 0 1px 0 #ffffffb0;
  overflow: hidden;
}
.ribbon-chart {
  width: 100%;
  height: 135px;
  overflow: hidden;
}
.base {
  stroke: color-mix(in srgb, var(--accent) 24%, transparent);
  stroke-width: 1;
  stroke-dasharray: 3 8;
}
.area {
  fill: url(#ribbon-fill);
}
.line-glow {
  fill: none;
  stroke: color-mix(in srgb, var(--orb-c) 46%, transparent);
  stroke-width: 13;
  filter: blur(9px);
}
.line {
  fill: none;
  stroke: url(#ribbon-stroke);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 2px 2px #ffffffb3);
}
.pt circle {
  stroke: #fff;
  stroke-width: 2.5;
  filter: drop-shadow(0 2px 4px #678fbd8a);
}
.pt.warm circle {
  fill: var(--cheek);
}
.pt.cool circle {
  fill: var(--orb-c);
}
.empty-line {
  font-size: 13px;
  padding: 34px 20px;
}
.recent {
  display: flex;
  gap: 9px;
  margin: 14px 0 0;
  padding: 1px 1px 5px;
  list-style: none;
  overflow-x: auto;
}
.recent li {
  display: grid;
  flex: 0 0 auto;
  width: 186px;
  gap: 3px;
  padding: 11px 13px;
  border-radius: 18px;
  background: linear-gradient(145deg, #ffffffbd, #ffffff6e);
  border: 1px solid #ffffffdf;
  box-shadow: inset 0 1px 0 #fff;
  transition:
    transform 0.42s var(--spring),
    box-shadow 0.25s;
}
.recent li:hover {
  transform: translateY(-4px) scale(1.025);
  box-shadow: 0 13px 25px -18px #5884b4;
}
.recent li::before {
  content: "";
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--orb-c);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--orb-c) 13%, transparent);
}
.recent li.warm::before {
  background: var(--cheek);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--cheek) 16%, transparent);
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
@keyframes ribbon-drift {
  to {
    transform: translate(-45px, 45px) rotate(30deg);
  }
}
@media (max-width: 680px) {
  .ribbon {
    padding: 21px 18px 16px;
  }
  .ribbon-head {
    display: grid;
  }
  .latest-mood {
    max-width: none;
    width: 100%;
  }
}
</style>
