<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MOODS } from "../../mood/themes";
import { intensity, mood, motionOn } from "../../mood/useMood";
import { wallpapers } from "../../wallpaper";
import { ParticleField } from "./particles";

const canvas = ref<HTMLCanvasElement>();
const gardenStyle = computed(() =>
  wallpapers.sky
    ? {
        backgroundImage: `url("${wallpapers.sky}")`,
        opacity: String(wallpapers.skyOpacity),
      }
    : undefined,
);
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
    <div
      class="garden"
      :class="{ custom: Boolean(wallpapers.sky) }"
      :style="gardenStyle"
    ></div>
    <div class="glow g1"></div>
    <div class="glow g2"></div>
    <div class="glow g3"></div>
    <div class="glow g4"></div>
    <div class="horizon"></div>
    <div class="landscape"><i></i><i></i><i></i><i></i></div>
    <div class="sheen"></div>
    <div v-if="mood === 'night'" class="moon"></div>
  <div class="vignette"></div>
  <canvas ref="canvas" class="particles" :class="{ off: !motionOn }"></canvas>
  </div>
</template>

<style scoped>
.sky {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  contain: paint;
  pointer-events: none;
}
.sky-base {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse at 13% 16%,
      rgb(255 255 255 / 0.83),
      transparent 38%
    ),
    radial-gradient(
      ellipse at 82% 8%,
      color-mix(in srgb, var(--glow-b) 36%, transparent),
      transparent 46%
    ),
    linear-gradient(
      168deg,
      var(--sky-top) 0%,
      var(--sky-mid) 48%,
      var(--sky-bottom) 100%
    );
}
.garden {
  position: absolute;
  inset: 0;
  background: url("../../assets/liquid-garden.png") center 58% / cover no-repeat;
  opacity: 0.22;
  mask-image: linear-gradient(180deg, transparent 8%, #000 42%, #000 100%);
}
.garden.custom {
  mask-image: none;
  background-position: center;
  background-size: cover;
}
.glow {
  position: absolute;
  border-radius: 50%;
  opacity: calc(0.55 + var(--intensity, 0.5) * 0.2);
}
.g1 {
  left: -18vmax;
  top: -20vmax;
  width: 58vmax;
  height: 58vmax;
  background: radial-gradient(circle, var(--glow-a) 0%, transparent 64%);
  animation: sky-drift-a calc(34s / var(--tempo, 1)) ease-in-out infinite
    alternate;
}
.g2 {
  right: -16vmax;
  top: 8vh;
  width: 48vmax;
  height: 48vmax;
  background: radial-gradient(circle, var(--glow-b) 0%, transparent 66%);
  animation: sky-drift-b calc(41s / var(--tempo, 1)) ease-in-out infinite
    alternate;
}
.g3 {
  left: 22vw;
  bottom: -24vmax;
  width: 46vmax;
  height: 46vmax;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--glow-a) 70%, var(--glow-b)) 0%,
    transparent 68%
  );
  animation: sky-drift-a calc(47s / var(--tempo, 1)) ease-in-out infinite
    alternate-reverse;
}
.g4 {
  left: 48vw;
  top: 18vh;
  width: 28vmax;
  height: 28vmax;
  background: radial-gradient(
    circle,
    color-mix(in srgb, white 55%, var(--glow-b)) 0%,
    transparent 70%
  );
  opacity: 0.45;
  animation: sky-drift-b calc(28s / var(--tempo, 1)) ease-in-out infinite
    alternate-reverse;
}
.horizon {
  position: absolute;
  left: -12%;
  right: -12%;
  bottom: -6%;
  height: 46%;
  background: radial-gradient(
    ellipse at 50% 0%,
    color-mix(in srgb, var(--glow-a) 62%, transparent),
    transparent 68%
  );
}
.sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 36%,
    color-mix(in srgb, white 14%, transparent) 50%,
    transparent 64%
  );
  pointer-events: none;
}
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 50% 40%,
    transparent 42%,
    color-mix(in srgb, var(--ink) 14%, transparent) 100%
  );
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
  opacity: 0.55;
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

.landscape {
  position: absolute;
  inset: 0;
  overflow: hidden;
  contain: paint;
  opacity: 0.55;
  pointer-events: none;
}
.landscape i {
  position: absolute;
  width: 77vw;
  height: 48vw;
  right: -20vw;
  top: 6vh;
  border-radius: 61% 39% 45% 55% / 47% 65% 35% 53%;
  background: radial-gradient(
    ellipse at 34% 42%,
    rgb(255 255 255 / 0.85),
    color-mix(in srgb, var(--glow-b) 53%, transparent) 38%,
    transparent 72%
  );
  transform: rotate(-24deg);
}
.landscape i:nth-child(2) {
  right: -19vw;
  top: 38vh;
  width: 61vw;
  height: 35vw;
  opacity: 0.66;
  background: radial-gradient(
    ellipse at 44% 48%,
    rgb(255 255 255 / 0.76),
    color-mix(in srgb, var(--glow-a) 48%, transparent) 46%,
    transparent 74%
  );
}
.landscape i:nth-child(3) {
  left: -34vw;
  right: auto;
  top: 32vh;
  width: 72vw;
  height: 43vw;
  opacity: 0.72;
  background: radial-gradient(
    ellipse at 52% 52%,
    rgb(255 255 255 / 0.86),
    color-mix(in srgb, var(--glow-a) 52%, transparent) 43%,
    transparent 71%
  );
}
.landscape i:nth-child(4) {
  left: 5vw;
  right: auto;
  top: 74vh;
  width: 69vw;
  height: 28vw;
  opacity: 0.58;
  background: radial-gradient(
    ellipse at 49% 31%,
    rgb(255 255 255 / 0.92),
    color-mix(in srgb, var(--glow-b) 38%, transparent) 55%,
    transparent 80%
  );
}
</style>
