<script setup lang="ts">
import { computed } from "vue";
import { hueOf, initials } from "../../format";
import { liveMood } from "../../mood/useMood";
import TaOrb from "../../components/ta/TaOrb.vue";

const props = defineProps<{ people: any[]; activity?: string }>();
const emit = defineEmits<{ open: [id: string] }>();

// Same threshold as the server's "好久不见".
const LONG_ABSENCE_DAYS = 14;

const nodes = computed(() =>
  [...props.people]
    .sort((a, b) => b.familiarity - a.familiarity)
    .map((p, i) => {
      const away = (p.awayDays ?? 0) >= LONG_ABSENCE_DAYS;
      const reach = away
        ? 0.92
        : 0.3 + (1 - Math.max(0, Math.min(1, p.familiarity))) * 0.56;
      const angle = i * 2.39996 + 0.35;
      return {
        ...p,
        away,
        x: 50 + Math.cos(angle) * reach * 44,
        y: 50 + Math.sin(angle) * reach * 41,
        size: Math.round(44 + Math.max(0, p.closeness) * 26),
        hue: hueOf(p.name || p.userId),
        delay: (i % 5) * -1.1,
      };
    }),
);
</script>

<template>
  <div class="galaxy" role="group" aria-label="人物星系：越熟悉离 TA 越近">
    <span class="ring r1" aria-hidden="true"></span>
    <span class="ring r2" aria-hidden="true"></span>
    <span class="ring r3" aria-hidden="true"></span>
    <svg
      class="threads"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        v-for="n in nodes"
        :key="n.userId"
        x1="50"
        y1="50"
        :x2="n.x"
        :y2="n.y"
        :style="{ opacity: n.away ? 0.12 : 0.18 + n.closeness * 0.5 }"
      />
    </svg>
    <div class="center">
      <TaOrb :mood="liveMood" :activity="activity || 'idle'" :size="96" />
      <b>TA</b>
    </div>
    <button
      v-for="n in nodes"
      :key="n.userId"
      class="person-node"
      :class="{ away: n.away, tense: n.tension >= 0.3 }"
      :data-person="n.userId"
      :style="{
        left: n.x + '%',
        top: n.y + '%',
        '--size': n.size + 'px',
        '--hue': n.hue,
        '--delay': n.delay + 's',
      }"
      :aria-label="`${n.name}：${n.feel}`"
      @click="emit('open', n.userId)"
    >
      <span class="float">
        <span class="avatar">{{ initials(n.name) }}</span>
        <span class="name">{{ n.name }}</span>
        <small>{{ n.feel }}</small>
      </span>
    </button>
    <p class="caption">越熟悉离 TA 越近 · 好久不见的在最外圈</p>
  </div>
</template>

<style scoped>
.galaxy {
  position: relative;
  height: 560px;
  overflow: hidden;
  border-radius: var(--r-l);
  background:
    radial-gradient(
      circle at 50% 50%,
      color-mix(in srgb, var(--glow-a) 70%, transparent),
      transparent 60%
    ),
    var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(14px);
}
.ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1.5px dashed color-mix(in srgb, var(--accent) 22%, transparent);
  transform: translate(-50%, -50%);
}
.r1 {
  width: 38%;
  height: 36%;
}
.r2 {
  width: 64%;
  height: 60%;
}
.r3 {
  width: 88%;
  height: 84%;
  border-style: dotted;
}
.threads {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.threads line {
  stroke: var(--accent);
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}
.center {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  justify-items: center;
  transform: translate(-50%, -56%);
  pointer-events: none;
}
.center b {
  margin-top: -6px;
  font-size: 13px;
  color: var(--ink-soft);
}
.person-node {
  position: absolute;
  width: 116px;
  padding: 4px;
  border: none;
  background: transparent;
  transform: translate(-50%, -30%);
}
.float {
  display: grid;
  justify-items: center;
  gap: 2px;
  animation: bob 6s ease-in-out var(--delay, 0s) infinite alternate;
}
.person-node:hover:not(:disabled) {
  box-shadow: none;
  transform: translate(-50%, -30%);
}
.avatar {
  display: grid;
  place-items: center;
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 30%,
    hsl(var(--hue) 90% 92%),
    hsl(var(--hue) 65% 72%)
  );
  border: 3px solid var(--surface-strong);
  box-shadow: 0 10px 20px -10px hsl(var(--hue) 60% 40%);
  color: hsl(var(--hue) 45% 22%);
  font: 700 15px var(--font-display);
  transition: transform 0.3s var(--spring);
}
.person-node:hover .avatar,
.person-node:focus-visible .avatar {
  transform: scale(1.12);
}
.person-node.tense .avatar {
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--danger) 55%, transparent),
    0 10px 20px -10px hsl(var(--hue) 60% 40%);
}
.person-node.away {
  opacity: 0.55;
  filter: grayscale(0.6);
}
.name {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-node small {
  max-width: 100%;
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caption {
  position: absolute;
  left: 18px;
  bottom: 14px;
  font-size: 12px;
  color: var(--ink-soft);
}
@keyframes bob {
  from {
    translate: 0 0;
  }
  to {
    translate: 0 -6px;
  }
}
@media (max-width: 760px) {
  .galaxy {
    height: 460px;
  }
  .person-node {
    width: 84px;
  }
  .person-node small {
    display: none;
  }
  .center :deep(.ta-orb) {
    width: 64px !important;
    height: 64px !important;
  }
}
</style>
