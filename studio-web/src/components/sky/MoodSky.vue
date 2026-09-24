<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MOODS } from "../../mood/themes";
import { intensity, mood, motionOn } from "../../mood/useMood";
import { ParticleField } from "./particles";

const canvas = ref<HTMLCanvasElement>();
const particles = computed(() =>
  motionOn.value ? MOODS[mood.value].particle : "off",
);
let field: ParticleField | null = null;
let settle = 0;

function sync() {
  if (!field) return;
  field.configure(MOODS[mood.value].particle, intensity.value);
  clearTimeout(settle);
  // Registered colors glide for a second or so; read them again once settled.
  settle = window.setTimeout(() => field?.readColors(), 1500);
  if (motionOn.value && !document.hidden) field.start();
  else field.stop();
}

function onResize() {
  field?.resize();
}

function onVisibility() {
  if (!field) return;
  if (document.hidden) field.stop();
  else if (motionOn.value) field.start();
}

onMounted(() => {
  if (!canvas.value) return;
  try {
    field = new ParticleField(canvas.value);
  } catch {
    return;
  }
  field.resize();
  sync();
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
});

watch([mood, intensity, motionOn], sync);

onBeforeUnmount(() => {
  field?.stop();
  clearTimeout(settle);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <div class="sky" aria-hidden="true" :data-particles="particles">
    <div class="sky-base"></div>
    <div class="glow g1"></div>
    <div class="glow g2"></div>
    <div class="glow g3"></div>
    <div v-if="mood === 'night'" class="moon"></div>
    <canvas ref="canvas" class="particles" :class="{ off: !motionOn }"></canvas>
  </div>
</template>

<style scoped>
.sky {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.sky-base {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    168deg,
    var(--sky-top) 0%,
    var(--sky-mid) 48%,
    var(--sky-bottom) 100%
  );
}
.glow {
  position: absolute;
  border-radius: 50%;
  opacity: calc(0.45 + var(--intensity, 0.5) * 0.4);
  will-change: transform;
}
.g1 {
  left: -12vmax;
  top: -16vmax;
  width: 52vmax;
  height: 52vmax;
  background: radial-gradient(circle, var(--glow-a) 0%, transparent 68%);
  animation: sky-drift-a calc(34s / var(--tempo, 1)) ease-in-out infinite
    alternate;
}
.g2 {
  right: -14vmax;
  top: 16vh;
  width: 46vmax;
  height: 46vmax;
  background: radial-gradient(circle, var(--glow-b) 0%, transparent 68%);
  animation: sky-drift-b calc(41s / var(--tempo, 1)) ease-in-out infinite
    alternate;
}
.g3 {
  left: 28vw;
  bottom: -22vmax;
  width: 40vmax;
  height: 40vmax;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--glow-a) 55%, var(--glow-b)) 0%,
    transparent 68%
  );
  animation: sky-drift-a calc(47s / var(--tempo, 1)) ease-in-out infinite
    alternate-reverse;
}
.moon {
  position: absolute;
  top: 3vh;
  right: 24vw;
  width: 78px;
  height: 78px;
  border-radius: 50%;
  box-shadow: inset -20px -7px 0 0 #fff4c2;
  filter: drop-shadow(0 0 26px rgb(255 240 190 / 0.45));
  transform: rotate(-20deg);
  opacity: 0.92;
}
.particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.particles.off {
  display: none;
}
@keyframes sky-drift-a {
  to {
    transform: translate(6vmax, 4vmax) scale(1.08);
  }
}
@keyframes sky-drift-b {
  to {
    transform: translate(-5vmax, 6vmax) scale(0.94);
  }
}
@media (max-width: 760px) {
  .moon {
    width: 52px;
    height: 52px;
    top: 1.5vh;
    right: 36vw;
    box-shadow: inset -13px -5px 0 0 #fff4c2;
  }
}
</style>
