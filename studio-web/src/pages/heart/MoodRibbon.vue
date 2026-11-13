<script setup lang="ts">
import { t } from "../../i18n";
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
        <h2>{{ t("心情记录") }}</h2>
        <p>
          {{
            t("最近 {length} 次被经历牵动；有起伏，也会慢慢平静。", {
              length: moods.length,
            })
          }}
        </p>
      </div>
      <div v-if="latest" class="latest-mood">
        <span>{{ t("刚刚留下的心情") }}</span>
        <b>{{ latest.feeling }}</b>
        <small>{{ latest.cause || t("暂时说不清缘由") }}</small>
      </div>
    </div>
    <div ref="box" class="ribbon-box">
      <svg
        v-if="path"
        class="ribbon-chart"
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        :aria-label="t('最近的心情曲线')"
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
                p.cause || t("说不清为什么")
              }}
            </title>
          </circle>
        </g>
      </svg>
      <p v-else class="muted empty-line">
        {{
          t(
            "心情还没有被什么事牵动过。每一次经历都可能推动 TA 的心情，随后又会慢慢回到平常。",
          )
        }}
      </p>
    </div>
    <ul v-if="recent.length" class="recent" :aria-label="t('最近的心情')">
      <li
        v-for="m in recent"
        :key="m.id"
        :class="m.valence >= 0 ? 'warm' : 'cool'"
      >
        <b>{{ m.feeling }}</b>
        <span>{{ m.cause || t("说不清为什么") }}</span>
        <small
          >{{ clockTime(m.created, timeZone) }} ·
          {{ ORIGIN_LABELS[m.origin] || m.origin }}</small
        >
      </li>
    </ul>
  </section>
</template>

<style scoped>
@layer components {
  .ribbon {
    padding: 22px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    min-width: 0;
  }
  .ribbon-head {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-start;
  }
  .ribbon-title h2 {
    font-size: 17px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .ribbon-title p {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .latest-mood {
    display: grid;
    gap: 4px;
    text-align: right;
    max-width: 40%;
  }
  .latest-mood span,
  .latest-mood small {
    font-size: 11px;
    color: var(--ink-soft);
  }
  .latest-mood b {
    font-size: 15px;
    color: var(--accent);
  }
  .ribbon-box {
    height: 150px;
    margin: 16px 0;
  }
  .ribbon-chart {
    display: block;
    width: 100%;
    height: 150px;
    overflow: visible;
  }
  .base {
    stroke: var(--line);
    stroke-dasharray: 4 5;
  }
  .area {
    fill: url(#ribbon-fill);
  }
  .line {
    fill: none;
    stroke: url(#ribbon-stroke);
    stroke-width: 2.5;
  }
  .line-glow {
    display: none;
  }
  .pt circle {
    fill: var(--surface);
    stroke: var(--accent);
    stroke-width: 2;
    transition: r 0.2s;
  }
  .pt:hover circle {
    stroke-width: 3;
  }
  .empty-line {
    display: grid;
    place-items: center;
    min-height: 120px;
    font-size: 13px;
  }
  .recent {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recent li {
    display: grid;
    gap: 6px;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .recent b {
    font-size: 13px;
    font-weight: 500;
  }
  .recent span {
    font-size: 12px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  .recent small {
    font-size: 10px;
    color: var(--ink-faint);
  }
  @media (max-width: 680px) {
    .recent {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ribbon-head {
      flex-direction: column;
      gap: 12px;
    }
    .latest-mood {
      text-align: left;
      max-width: 100%;
    }
  }
}
</style>
