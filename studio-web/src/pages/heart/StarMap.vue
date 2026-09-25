<script setup lang="ts">
import { computed } from "vue";
import { KIND_COLORS } from "../../plates/mind";
import { liveMood } from "../../mood/useMood";
import TaOrb from "../../components/ta/TaOrb.vue";

const props = defineProps<{
  threads: any[];
  kinds: Record<string, string>;
  activity?: string;
}>();
const emit = defineEmits<{ open: [thread: any] }>();
const groups = computed(() =>
  [...new Set(props.threads.map((t) => t.kind))].map((kind) => ({
    kind,
    label: props.kinds[kind] || kind,
    color: KIND_COLORS[kind] || "var(--accent)",
    items: props.threads
      .filter((t) => t.kind === kind)
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0)),
  })),
);
const closeCount = computed(
  () =>
    props.threads.filter((t) => !t.faded && (t.salience ?? 0) >= 0.5).length,
);
function stateOf(t: any) {
  return t.faded ? "暂时放远" : t.core ? "慢慢笃定" : "还在生长";
}
</script>

<template>
  <section class="starmap" aria-label="心灵星图：TA 关于自己的线索">
    <div class="self-scene">
      <div class="scene-copy">
        <span class="eyebrow">SELF / 正在形成的自己</span>
        <h2>不是一张固定的画像，<br /><em>而是一直在生长。</em></h2>
        <p>
          一件经历可能留下一点痕迹。点开一枚光片，可以看到它从哪里来、后来又怎么改变。
        </p>
        <div class="scene-stats">
          <span
            ><b>{{ threads.length }}</b> 枚线索</span
          ><span
            ><b>{{ closeCount }}</b> 枚此刻贴近</span
          >
        </div>
      </div>
      <div class="self-lens" aria-hidden="true">
        <span class="lens-halo halo-one"></span
        ><span class="lens-halo halo-two"></span>
        <span class="lens-droplet droplet-one"></span
        ><span class="lens-droplet droplet-two"></span
        ><span class="lens-droplet droplet-three"></span>
        <div class="orb-seat">
          <TaOrb :mood="liveMood" :activity="activity || 'idle'" :size="106" />
        </div>
      </div>
    </div>
    <div class="currents-head">
      <div>
        <span class="eyebrow">INNER CURRENTS</span>
        <h3>她留下的光片</h3>
      </div>
      <p>越亮的线索，越贴近此刻。淡去的仍然保留在这里。</p>
    </div>
    <div class="current-grid">
      <section
        v-for="(group, index) in groups"
        :key="group.kind"
        class="current"
        :style="{ '--tone': group.color, '--order': index }"
      >
        <header class="current-head">
          <span class="current-icon" aria-hidden="true"><i></i></span>
          <div>
            <h4>{{ group.label }}</h4>
            <small>{{ group.items.length }} 枚正在留存</small>
          </div>
          <span class="current-number">{{
            String(index + 1).padStart(2, "0")
          }}</span>
        </header>
        <div class="flecks">
          <button
            v-for="thread in group.items"
            :key="thread.thread"
            type="button"
            class="fleck star"
            :class="{ faded: thread.faded, core: thread.core }"
            :data-thread="thread.thread"
            @click="emit('open', thread)"
          >
            <span class="fleck-light" aria-hidden="true"></span>
            <span class="fleck-copy"
              ><small>{{ stateOf(thread) }}</small
              ><b>{{ thread.content }}</b></span
            >
            <span class="fleck-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.starmap {
  display: grid;
  gap: 23px;
  min-width: 0;
}
.self-scene {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: 302px;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(280px, 0.88fr);
  align-items: center;
  border-radius: 38px;
  padding: 30px clamp(25px, 4vw, 52px);
  border: 1px solid #ffffffe0;
  background: linear-gradient(112deg, #ffffffb3, #edf8ff61 44%, #ffeef861);
  box-shadow:
    inset 0 2px 0 #fffffff7,
    inset 0 -1px 0 #ffffffb3,
    0 26px 60px -39px #5572b66b;
  backdrop-filter: blur(28px) saturate(1.7);
  -webkit-backdrop-filter: blur(28px) saturate(1.7);
}
.self-scene::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 62%;
  aspect-ratio: 1;
  right: -15%;
  top: -82%;
  border-radius: 50%;
  background: conic-gradient(
    from 35deg,
    #f5dbff88,
    #b9eaff55,
    #fff9eaa8,
    #b9eaff55,
    #f5dbff88
  );
  filter: blur(24px);
  animation: scene-drift 14s ease-in-out infinite alternate;
}
.scene-copy {
  position: relative;
  z-index: 1;
}
.scene-copy h2 {
  margin: 14px 0 15px;
  font-size: clamp(28px, 3.6vw, 46px);
  line-height: 1.18;
  letter-spacing: -0.05em;
}
.scene-copy h2 em {
  font-style: normal;
  background: linear-gradient(110deg, #5787c9, #8c70c4 48%, #d591b4);
  color: transparent;
  background-clip: text;
  -webkit-background-clip: text;
}
.scene-copy p {
  max-width: 53ch;
  color: var(--ink-soft);
  line-height: 1.8;
  font-size: 13px;
}
.scene-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 20px;
}
.scene-stats span {
  padding: 7px 14px;
  border-radius: 99px;
  border: 1px solid #ffffffdb;
  background: #ffffff78;
  box-shadow:
    inset 0 1px 0 #fff,
    0 6px 22px -15px #5d83c7;
  color: var(--ink-soft);
  font-size: 12px;
  backdrop-filter: blur(12px);
}
.scene-stats b {
  color: var(--accent);
  font-size: 14px;
}
.self-lens {
  position: relative;
  justify-self: center;
  width: min(100%, 330px);
  aspect-ratio: 1.2;
  display: grid;
  place-items: center;
}
.lens-halo {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.halo-one {
  width: 79%;
  aspect-ratio: 1;
  background: radial-gradient(
    circle at 34% 28%,
    #ffffffdf 2%,
    #d5f4ff99 29%,
    #d3e6ff50 55%,
    #f7dffa80 75%,
    transparent 76%
  );
  border: 1px solid #ffffffda;
  box-shadow:
    inset 9px 12px 24px #ffffffd4,
    inset -13px -15px 24px #aeccf050,
    0 22px 44px -27px #7ea8dc;
  animation: lens-breathe 6s ease-in-out infinite;
}
.halo-two {
  width: 98%;
  aspect-ratio: 1.1;
  border: 1px solid #ffffffad;
  transform: rotate(-18deg);
  box-shadow:
    0 0 36px #d3e8ff78,
    inset 0 0 30px #fff8;
}
.orb-seat {
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 16px 14px #799bd844);
  animation: orb-float 5s ease-in-out infinite;
}
.lens-droplet {
  position: absolute;
  z-index: 2;
  width: 34px;
  aspect-ratio: 1;
  border-radius: 46% 54% 61% 39%;
  border: 1px solid #fff;
  background: radial-gradient(
    circle at 28% 25%,
    #fff 7%,
    #e4eaffad 23%,
    #9dc8ef99 75%,
    #ffffffc0
  );
  box-shadow:
    inset 3px 3px 5px #fff,
    0 9px 18px #7299c64a;
  animation: orb-float 4.8s ease-in-out infinite alternate;
}
.droplet-one {
  top: 14%;
  right: 13%;
}
.droplet-two {
  width: 21px;
  left: 5%;
  bottom: 24%;
  animation-delay: -2s;
}
.droplet-three {
  width: 13px;
  right: 5%;
  bottom: 13%;
  animation-delay: -3s;
}
.currents-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  padding: 0 5px;
}
.currents-head h3 {
  margin-top: 4px;
  font-size: clamp(19px, 2vw, 25px);
}
.currents-head p {
  max-width: 32ch;
  font-size: 12px;
  text-align: right;
  color: var(--ink-soft);
}
.current-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.current {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  border-radius: 29px;
  border: 1px solid #ffffffe0;
  background: linear-gradient(
    142deg,
    #ffffffb3,
    #ffffff40 54%,
    color-mix(in srgb, var(--tone) 7%, transparent)
  );
  box-shadow:
    inset 0 1px 1px #fff,
    0 18px 35px -30px #5b7cac;
  backdrop-filter: blur(24px) saturate(1.55);
  -webkit-backdrop-filter: blur(24px) saturate(1.55);
  animation: current-in 0.6s var(--spring) both;
  animation-delay: calc(var(--order) * 55ms);
}
.current::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 160px;
  height: 160px;
  right: -60px;
  top: -85px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tone) 18%, #fff8);
  filter: blur(25px);
}
.current-head {
  display: flex;
  gap: 11px;
  align-items: center;
}
.current-head h4 {
  font-size: 15px;
}
.current-head small {
  color: var(--ink-soft);
  font-size: 11px;
}
.current-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 15px 16px 14px 18px;
  border: 1px solid #fff;
  background: radial-gradient(
    circle at 25% 20%,
    #fff 0%,
    color-mix(in srgb, var(--tone) 33%, white) 63%,
    color-mix(in srgb, var(--tone) 53%, white)
  );
  box-shadow:
    inset 0 2px 2px #fff,
    0 8px 16px -10px var(--tone);
}
.current-icon i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 4px #fff8;
}
.current-number {
  margin-left: auto;
  align-self: start;
  font: 700 12px var(--font-mono);
  color: color-mix(in srgb, var(--tone) 55%, var(--ink-soft));
}
.flecks {
  display: grid;
  gap: 8px;
}
.fleck {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-width: 0;
  min-height: 60px;
  padding: 9px 13px;
  border-radius: 19px;
  border: 1px solid #ffffffd9;
  background: linear-gradient(
    120deg,
    #ffffffc9,
    #ffffff76 75%,
    color-mix(in srgb, var(--tone) 7%, #ffffff70)
  );
  box-shadow:
    inset 0 1px 0 #fff,
    0 8px 20px -17px #4269a4;
  text-align: left;
  transition:
    transform 0.46s var(--spring),
    box-shadow 0.3s ease,
    background 0.3s ease;
}
.fleck:hover:not(:disabled),
.fleck:focus-visible {
  transform: translateY(-3px) scale(1.012);
  box-shadow:
    inset 0 1px 0 #fff,
    0 16px 27px -18px var(--tone);
  background: #ffffffd9;
}
.fleck:active:not(:disabled) {
  transform: translateY(0) scale(0.976);
}
.fleck-light {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 48% 52% 55% 45%;
  background: radial-gradient(
    circle at 28% 23%,
    #fff,
    color-mix(in srgb, var(--tone) 62%, white)
  );
  border: 1px solid #fff;
  box-shadow:
    inset 0 1px 0 #fff,
    0 0 0 5px color-mix(in srgb, var(--tone) 11%, transparent);
  transition: transform 0.45s var(--spring);
}
.fleck:hover .fleck-light {
  transform: scale(1.35) rotate(18deg);
}
.fleck-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.fleck-copy small {
  color: var(--ink-faint);
  font-size: 10px;
}
.fleck-copy b {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.fleck-arrow {
  margin-left: auto;
  color: var(--accent);
  opacity: 0.5;
  transition:
    transform 0.4s var(--spring),
    opacity 0.2s;
}
.fleck:hover .fleck-arrow {
  transform: translate(3px, -3px);
  opacity: 1;
}
.fleck.faded {
  opacity: 0.63;
}
.fleck.core {
  border-color: color-mix(in srgb, var(--tone) 35%, #fff);
}
@keyframes scene-drift {
  to {
    transform: translate(-15%, 12%) rotate(30deg);
  }
}
@keyframes lens-breathe {
  50% {
    transform: scale(1.045);
  }
}
@keyframes orb-float {
  50% {
    transform: translateY(-9px);
  }
}
@keyframes current-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.975);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (max-width: 850px) {
  .self-scene {
    grid-template-columns: 1fr 240px;
  }
  .self-lens {
    width: 230px;
  }
}
@media (max-width: 680px) {
  .self-scene {
    grid-template-columns: 1fr;
    padding: 26px;
  }
  .self-lens {
    width: 220px;
    height: 170px;
    justify-self: end;
    margin-top: -10px;
  }
  .current-grid {
    grid-template-columns: 1fr;
  }
  .currents-head {
    display: block;
  }
  .currents-head p {
    margin-top: 5px;
    text-align: left;
  }
}
</style>
