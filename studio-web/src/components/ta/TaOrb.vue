<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { motionOn } from "../../mood/useMood";
import type { MoodKey } from "../../mood/themes";
import { reactionLine } from "./reactions";

type Eyes =
  "open" | "happy" | "closed" | "sad" | "cross" | "sleepy" | "up" | "down";
type Mouth =
  | "smile"
  | "small"
  | "grin"
  | "cat"
  | "frown"
  | "wavy"
  | "yawn"
  | "sleep"
  | "talk"
  | "smirk"
  | "flat";
interface Look {
  wobble: number;
  speed: number;
  bounce: number;
  droop: number;
  jitter: number;
  eyes: Eyes;
  mouth: Mouth;
  cheeks: number;
}
export type Traits = Partial<
  Record<"warmth" | "sarcasm" | "humor" | "activity" | "initiative", number>
>;

const props = withDefaults(
  defineProps<{
    mood?: MoodKey;
    activity?: string;
    size?: number;
    interactive?: boolean;
    speech?: string;
    traits?: Traits | null;
    bubbleSide?: "top" | "left";
    label?: string;
  }>(),
  {
    mood: "calm",
    activity: "idle",
    size: 160,
    interactive: false,
    speech: "",
    traits: null,
    bubbleSide: "top",
    label: "",
  },
);
const emit = defineEmits<{ "open-chat": []; react: [kind: "poke" | "pet"] }>();

const LOOKS: Record<MoodKey, Look> = {
  calm: {
    wobble: 0.6,
    speed: 0.8,
    bounce: 0,
    droop: 0,
    jitter: 0,
    eyes: "open",
    mouth: "small",
    cheeks: 0.25,
  },
  sweet: {
    wobble: 0.8,
    speed: 1,
    bounce: 1.6,
    droop: 0,
    jitter: 0,
    eyes: "happy",
    mouth: "cat",
    cheeks: 0.8,
  },
  bright: {
    wobble: 1,
    speed: 1.5,
    bounce: 7,
    droop: 0,
    jitter: 0,
    eyes: "happy",
    mouth: "grin",
    cheeks: 0.55,
  },
  blue: {
    wobble: 0.35,
    speed: 0.5,
    bounce: 0,
    droop: 4,
    jitter: 0,
    eyes: "sad",
    mouth: "frown",
    cheeks: 0.1,
  },
  stormy: {
    wobble: 1.1,
    speed: 1.2,
    bounce: 0,
    droop: 0,
    jitter: 0.9,
    eyes: "cross",
    mouth: "wavy",
    cheeks: 0.15,
  },
  drowsy: {
    wobble: 0.45,
    speed: 0.45,
    bounce: 0,
    droop: 2,
    jitter: 0,
    eyes: "sleepy",
    mouth: "yawn",
    cheeks: 0.35,
  },
  night: {
    wobble: 0.3,
    speed: 0.35,
    bounce: 0,
    droop: 3,
    jitter: 0,
    eyes: "closed",
    mouth: "sleep",
    cheeks: 0.3,
  },
};
const OPEN_EYES = new Set<Eyes>(["open", "sad", "cross", "up", "down"]);
const SPARKLES = [
  { x: 28, y: 48, r: 8, d: 0 },
  { x: 176, y: 36, r: 6, d: 0.8 },
  { x: 184, y: 128, r: 7, d: 1.5 },
  { x: 18, y: 138, r: 5, d: 2.1 },
];
const HEARTS = [
  { x: 164, y: 70, s: 7, d: 0 },
  { x: 34, y: 84, s: 5.5, d: 1.4 },
  { x: 178, y: 118, s: 4.5, d: 2.6 },
];

const uid = "orb" + Math.random().toString(36).slice(2, 8);
const ids = { fill: uid + "-fill", aura: uid + "-aura", rim: uid + "-rim" };
const blinkDelay = `${(Math.random() * 3).toFixed(2)}s`;

const root = ref<HTMLElement>();
const body = ref<SVGPathElement>();
const rim = ref<SVGPathElement>();
const whole = ref<SVGGElement>();
const shadow = ref<SVGEllipseElement>();
const look = ref({ x: 0, y: 0 });
const reaction = ref<"" | "poke" | "pet" | "press">("");
const said = ref("");

const face = computed<Look>(() => {
  const f = { ...LOOKS[props.mood] };
  const t = props.traits;
  if (t) {
    const warmth = t.warmth ?? 65;
    const activity = t.activity ?? 40;
    f.eyes = (t.humor ?? 25) > 60 ? "happy" : "open";
    f.mouth = (t.sarcasm ?? 5) > 40 ? "smirk" : warmth > 35 ? "smile" : "flat";
    f.cheeks = Math.max(0, (warmth - 30) / 70) * 0.9;
    f.bounce = (activity / 100) * 8;
    f.speed = 0.5 + (activity / 100) * 1.2;
    f.wobble = 0.4 + (activity / 100) * 0.8;
    f.jitter = 0;
    f.droop = 0;
  }
  switch (props.activity) {
    case "asleep":
      Object.assign(f, {
        eyes: "closed",
        mouth: "sleep",
        bounce: 0,
        speed: 0.35,
        wobble: 0.3,
        jitter: 0,
      });
      break;
    case "solitude":
    case "night":
    case "review":
      Object.assign(f, {
        eyes: "closed",
        mouth: "small",
        bounce: 0,
        jitter: 0,
      });
      break;
    case "diary":
    case "reading":
      f.eyes = "down";
      f.bounce = 0;
      if (f.mouth === "grin" || f.mouth === "wavy") f.mouth = "small";
      break;
    case "thinking":
      f.eyes = "up";
      if (f.mouth === "grin") f.mouth = "small";
      break;
    case "speaking":
      f.mouth = "talk";
      break;
  }
  if (reaction.value === "pet" && f.eyes !== "closed")
    Object.assign(f, { eyes: "happy", mouth: "cat", cheeks: 1 });
  else if (reaction.value === "pet") f.cheeks = 1;
  if (reaction.value === "poke" && f.eyes === "happy") f.eyes = "open";
  return f;
});

const small = computed(() => props.size < 72);
const pupil = computed(() =>
  face.value.eyes === "up"
    ? { x: 2, y: -3 }
    : face.value.eyes === "down"
      ? { x: 0, y: 2.5 }
      : { x: 0, y: 0 },
);
const smile = computed(() =>
  props.traits ? 0.3 + ((props.traits.warmth ?? 65) / 100) * 1.1 : 1,
);
const wink = computed(() => (props.traits?.humor ?? 0) > 45);
const brows = computed(() => {
  const { eyes, mouth } = face.value;
  if (eyes === "sad") return ["M70 95 Q78 92 87 90", "M113 90 Q122 92 130 95"];
  if (eyes === "cross") return ["M71 90 L87 95.5", "M113 95.5 L129 90"];
  if (mouth === "smirk") return ["M71 94 L87 93", "M113 90 Q121 85.5 129 89"];
  return null;
});
const traitStyle = computed(() => {
  const t = props.traits;
  if (!t) return undefined;
  const warm = ((t.warmth ?? 65) - 50) / 50;
  const initiative = (t.initiative ?? 25) / 100;
  return {
    filter: `hue-rotate(${Math.round(-warm * 28)}deg) saturate(${(1 + warm * 0.18).toFixed(2)})`,
    transform: `scale(${(0.92 + initiative * 0.14).toFixed(3)}) rotate(${((initiative - 0.25) * 8).toFixed(1)}deg)`,
  };
});
const bubble = computed(() => said.value || props.speech);
const ariaLabel = computed(
  () =>
    props.label ||
    (props.interactive ? "TA：戳一下，按住摸摸头，双击和 TA 聊聊" : "TA"),
);
const weather = computed(() => {
  if (small.value) return "";
  if (props.activity === "asleep") return "night";
  return props.mood;
});

// A soft closed shape through eight points that drift a little.
function blob(t: number, wobble: number, sx: number, sy: number) {
  const n = 8;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const noise =
      Math.sin(t * 1.3 + i * 1.7) * 0.6 + Math.sin(t * 0.7 + i * 2.9) * 0.4;
    const r = 62 * (1 + noise * 0.055 * wobble);
    const squash = Math.sin(a) > 0 ? 0.92 : 1.02;
    pts.push([100 + Math.cos(a) * r * sx, 112 + Math.sin(a) * r * sy * squash]);
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}
const restPath = blob(0, 0, 1, 1);

const born = performance.now() - Math.random() * 10000;
let raf = 0;
let last = 0;

function draw(now: number, still = false) {
  const f = face.value;
  const t = (now - born) / 1000;
  const s = t * f.speed;
  const breath = still ? 0 : Math.sin(s * 1.7) * 0.022;
  const hop =
    still || !f.bounce ? 0 : Math.max(0, Math.sin(s * 2.6)) ** 1.5 * f.bounce;
  const shake =
    still || !f.jitter || Math.sin(t * 0.8) < 0.55
      ? 0
      : Math.sin(t * 38) * f.jitter;
  const d = still
    ? restPath
    : blob(
        s,
        f.wobble,
        1 + breath - hop * 0.004,
        1 - breath * 0.7 + hop * 0.006,
      );
  body.value?.setAttribute("d", d);
  rim.value?.setAttribute("d", d);
  whole.value?.setAttribute(
    "transform",
    `translate(${shake.toFixed(2)} ${(f.droop - hop).toFixed(2)})`,
  );
  shadow.value?.setAttribute("rx", (46 * (1 - hop / 30)).toFixed(2));
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (now - last < 32) return;
  last = now;
  draw(now);
}

function animate() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (motionOn.value) raf = requestAnimationFrame(loop);
  else draw(performance.now(), true);
}

let lookFrame = 0;
function follow(event: PointerEvent) {
  if (lookFrame) return;
  lookFrame = requestAnimationFrame(() => {
    lookFrame = 0;
    const el = root.value;
    if (!el || face.value.eyes === "closed") {
      look.value = { x: 0, y: 0 };
      return;
    }
    const r = el.getBoundingClientRect();
    const dx = event.clientX - (r.left + r.width / 2);
    const dy = event.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dist / 360);
    look.value = {
      x: Math.round((dx / dist) * 4 * k * 10) / 10,
      y: Math.round((dy / dist) * 3 * k * 10) / 10,
    };
  });
}

function watchPointer(on: boolean) {
  window.removeEventListener("pointermove", follow);
  if (on && props.size >= 56)
    window.addEventListener("pointermove", follow, { passive: true });
  else look.value = { x: 0, y: 0 };
}

let sayTimer = 0;
let reactTimer = 0;
let pressTimer = 0;
function say(line: string) {
  said.value = line;
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => (said.value = ""), 2800);
}
function react(kind: "poke" | "pet") {
  reaction.value = kind;
  clearTimeout(reactTimer);
  reactTimer = window.setTimeout(
    () => (reaction.value = ""),
    kind === "pet" ? 1500 : 650,
  );
  say(reactionLine(kind, props.mood, props.activity));
  emit("react", kind);
}
function poke() {
  if (props.interactive) react("poke");
}
function pet() {
  if (props.interactive) react("pet");
}
function down(event: PointerEvent) {
  if (!props.interactive || event.button > 0) return;
  reaction.value = "press";
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    pressTimer = 0;
    react("pet");
  }, 520);
}
function up() {
  if (!props.interactive || !pressTimer) return;
  clearTimeout(pressTimer);
  pressTimer = 0;
  react("poke");
}
function cancel() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = 0;
  if (reaction.value === "press") reaction.value = "";
}

function star(x: number, y: number, r: number) {
  return `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
}
function heart(x: number, y: number, s: number) {
  return `M${x} ${y + s * 0.9}C${x - s * 1.6} ${y - s * 0.2} ${x - s * 0.6} ${y - s * 1.3} ${x} ${y - s * 0.45}C${x + s * 0.6} ${y - s * 1.3} ${x + s * 1.6} ${y - s * 0.2} ${x} ${y + s * 0.9}Z`;
}

watch([face, motionOn], animate);
watch(motionOn, watchPointer);
onMounted(() => {
  animate();
  watchPointer(motionOn.value);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  cancelAnimationFrame(lookFrame);
  window.removeEventListener("pointermove", follow);
  clearTimeout(sayTimer);
  clearTimeout(reactTimer);
  clearTimeout(pressTimer);
});

defineExpose({ poke, pet });
</script>

<template>
  <div
    ref="root"
    class="ta-orb"
    :class="[
      `mood-${mood}`,
      `act-${activity}`,
      reaction && `is-${reaction}`,
      { interactive, small },
    ]"
    :style="{
      width: size + 'px',
      height: size + 'px',
      '--blink-delay': blinkDelay,
    }"
    :role="interactive ? 'button' : 'img'"
    :tabindex="interactive ? 0 : undefined"
    :aria-label="ariaLabel"
    :data-mood="mood"
    :data-activity="activity"
    @pointerdown="down"
    @pointerup="up"
    @pointerleave="cancel"
    @pointercancel="cancel"
    @dblclick="emit('open-chat')"
    @keydown.enter.prevent="poke"
    @keydown.space.prevent="pet"
    @contextmenu.prevent
  >
    <svg viewBox="0 0 200 200" :style="traitStyle" aria-hidden="true">
      <defs>
        <radialGradient :id="ids.fill" cx="38%" cy="30%" r="78%">
          <stop offset="0%" style="stop-color: var(--orb-a)" />
          <stop offset="58%" style="stop-color: var(--orb-b)" />
          <stop offset="100%" style="stop-color: var(--orb-c)" />
        </radialGradient>
        <radialGradient :id="ids.aura">
          <stop
            offset="45%"
            style="stop-color: var(--orb-b); stop-opacity: 0.5"
          />
          <stop
            offset="100%"
            style="stop-color: var(--orb-b); stop-opacity: 0"
          />
        </radialGradient>
        <radialGradient :id="ids.rim" cx="50%" cy="50%" r="50%">
          <stop offset="72%" style="stop-color: #ffffff; stop-opacity: 0" />
          <stop offset="100%" style="stop-color: #ffffff; stop-opacity: 0.4" />
        </radialGradient>
      </defs>

      <circle
        class="aura"
        cx="100"
        cy="112"
        r="94"
        :fill="`url(#${ids.aura})`"
      />
      <g v-if="activity === 'solitude'" class="halo">
        <circle cx="100" cy="112" r="86" />
        <circle class="halo-soft" cx="100" cy="112" r="76" />
      </g>
      <ellipse ref="shadow" class="shadow" cx="100" cy="186" rx="46" ry="6" />

      <g class="squish">
        <g ref="whole">
          <path
            ref="body"
            class="body"
            :d="restPath"
            :fill="`url(#${ids.fill})`"
          />
          <path
            ref="rim"
            class="rim"
            :d="restPath"
            :fill="`url(#${ids.rim})`"
          />
          <ellipse
            class="shine"
            cx="76"
            cy="80"
            rx="17"
            ry="10"
            transform="rotate(-28 76 80)"
          />
          <ellipse class="shine dot" cx="98" cy="68" rx="4" ry="3" />

          <g class="face" :transform="`translate(${look.x} ${look.y})`">
            <g v-if="brows" class="brows">
              <path class="line thin" :d="brows[0]" />
              <path class="line thin" :d="brows[1]" />
            </g>
            <g class="eyes" :class="{ blinks: OPEN_EYES.has(face.eyes) }">
              <g
                v-for="(x, i) in [80, 120]"
                :key="i"
                class="eye"
                :class="{ wink: wink && i === 1 && OPEN_EYES.has(face.eyes) }"
              >
                <template v-if="OPEN_EYES.has(face.eyes)">
                  <ellipse
                    class="ink"
                    :cx="x + pupil.x"
                    :cy="106 + pupil.y"
                    rx="5.4"
                    :ry="face.eyes === 'sad' ? 6 : 7.2"
                  />
                  <circle
                    class="glint"
                    :cx="x + pupil.x + 1.8"
                    :cy="106 + pupil.y - 2.6"
                    r="1.9"
                  />
                </template>
                <path
                  v-else-if="face.eyes === 'happy'"
                  class="line"
                  :d="`M${x - 7} 108Q${x} 98 ${x + 7} 108`"
                />
                <path
                  v-else-if="face.eyes === 'closed'"
                  class="line"
                  :d="`M${x - 7} 105Q${x} 111 ${x + 7} 105`"
                />
                <g v-else>
                  <path
                    class="ink"
                    :d="`M${x - 6} 106A6 5 0 0 0 ${x + 6} 106Z`"
                  />
                  <path
                    class="line thin"
                    :d="`M${x - 7.5} 106L${x + 7.5} 106`"
                  />
                </g>
              </g>
            </g>
            <g class="cheeks" :style="{ opacity: face.cheeks }">
              <ellipse cx="70" cy="119" rx="9" ry="5.2" />
              <ellipse cx="130" cy="119" rx="9" ry="5.2" />
            </g>
            <g class="mouth">
              <path
                v-if="face.mouth === 'smile'"
                class="line"
                :d="`M89 124Q100 ${(124 + 9 * smile).toFixed(1)} 111 124`"
              />
              <path
                v-else-if="face.mouth === 'small'"
                class="line"
                d="M94 125Q100 129.5 106 125"
              />
              <g v-else-if="face.mouth === 'grin'">
                <path class="ink" d="M87 121Q100 140 113 121Z" />
                <path
                  class="tongue"
                  d="M94 129.5Q100 135 106 129.5Q100 127.5 94 129.5Z"
                />
              </g>
              <path
                v-else-if="face.mouth === 'cat'"
                class="line"
                d="M89 123Q94.5 129 100 123.5Q105.5 129 111 123"
              />
              <path
                v-else-if="face.mouth === 'frown'"
                class="line"
                d="M91 130Q100 122.5 109 130"
              />
              <path
                v-else-if="face.mouth === 'wavy'"
                class="line"
                d="M88 127q3 -3.4 6 0t6 0t6 0t6 0"
              />
              <ellipse
                v-else-if="face.mouth === 'yawn'"
                class="ink yawn"
                cx="100"
                cy="127"
                rx="4.6"
                ry="5.6"
              />
              <ellipse
                v-else-if="face.mouth === 'sleep'"
                class="ink"
                cx="100"
                cy="127"
                rx="2.6"
                ry="3"
              />
              <ellipse
                v-else-if="face.mouth === 'talk'"
                class="ink talk"
                cx="100"
                cy="126"
                rx="5"
                ry="4.5"
              />
              <path
                v-else-if="face.mouth === 'smirk'"
                class="line"
                d="M91 127Q102 130 110 121"
              />
              <path v-else class="line" d="M93 126L107 126" />
            </g>
          </g>

          <g v-if="activity === 'reading'" class="held">
            <path class="page" d="M100 150L72 142L72 167L100 175Z" />
            <path class="page" d="M100 150L128 142L128 167L100 175Z" />
            <path class="line thin" d="M100 150L100 175" />
          </g>
          <g v-else-if="activity === 'diary'" class="held">
            <rect
              class="page"
              x="118"
              y="150"
              width="50"
              height="34"
              rx="5"
              transform="rotate(-8 143 167)"
            />
            <path class="line hair" d="M126 163L156 159M127 171L150 168" />
            <g class="pen" transform="rotate(38 152 146)">
              <rect x="148" y="112" width="9" height="40" rx="3.5" />
              <path d="M148 152L152.5 163L157 152Z" />
            </g>
          </g>
        </g>
      </g>

      <g v-if="weather === 'bright'" class="fx">
        <path
          v-for="(s, i) in SPARKLES"
          :key="i"
          class="sparkle"
          :d="star(s.x, s.y, s.r)"
          :style="{ animationDelay: s.d + 's' }"
        />
      </g>
      <g v-else-if="weather === 'sweet'" class="fx">
        <path
          v-for="(h, i) in HEARTS"
          :key="i"
          class="heart"
          :d="heart(h.x, h.y, h.s)"
          :style="{ animationDelay: h.d + 's' }"
        />
      </g>
      <g v-else-if="weather === 'blue'" class="fx rain">
        <g class="cloud">
          <circle cx="30" cy="36" r="9" />
          <circle cx="42" cy="30" r="11" />
          <circle cx="54" cy="36" r="8" />
          <rect x="22" y="35" width="40" height="10" rx="5" />
        </g>
        <path class="drop" d="M31 50l-1.5 6" />
        <path class="drop" d="M42 50l-1.5 6" style="animation-delay: 0.45s" />
        <path class="drop" d="M53 50l-1.5 6" style="animation-delay: 0.9s" />
      </g>
      <g v-else-if="weather === 'stormy'" class="fx storm">
        <g class="cloud">
          <circle cx="156" cy="34" r="9" />
          <circle cx="168" cy="28" r="11" />
          <circle cx="180" cy="34" r="8" />
          <rect x="148" y="33" width="40" height="10" rx="5" />
        </g>
        <path class="scribble" d="M154 54q4 -5 8 0t8 0t8 0" />
      </g>
      <g v-else-if="weather === 'drowsy' && activity === 'idle'" class="fx">
        <text class="zz" x="158" y="58">z</text>
      </g>
      <g
        v-if="
          weather === 'night' || activity === 'review' || activity === 'night'
        "
        class="fx"
      >
        <path class="moon" d="M40 20a18 18 0 1 0 16 28a14 14 0 1 1 -16 -28Z" />
      </g>
      <g
        v-if="
          activity === 'asleep' || (mood === 'night' && activity === 'idle')
        "
        class="fx"
      >
        <text class="zz" x="150" y="64">z</text>
        <text
          class="zz"
          x="162"
          y="48"
          style="animation-delay: 1s; font-size: 16px"
        >
          z
        </text>
        <text
          class="zz"
          x="174"
          y="30"
          style="animation-delay: 2s; font-size: 20px"
        >
          Z
        </text>
      </g>
      <g v-if="activity === 'review' || activity === 'night'" class="fx">
        <g class="floating-page">
          <rect class="page" x="156" y="92" width="30" height="38" rx="4" />
          <path class="line hair" d="M162 103h18M162 111h18M162 119h11" />
        </g>
      </g>
      <g v-if="activity === 'thinking'" class="fx think">
        <circle class="puff" cx="146" cy="58" r="3.5" />
        <circle class="puff" cx="156" cy="45" r="5" />
        <ellipse class="puff" cx="176" cy="24" rx="21" ry="14" />
        <circle class="dot" cx="167" cy="24" r="2.6" />
        <circle
          class="dot"
          cx="176"
          cy="24"
          r="2.6"
          style="animation-delay: 0.18s"
        />
        <circle
          class="dot"
          cx="185"
          cy="24"
          r="2.6"
          style="animation-delay: 0.36s"
        />
      </g>
      <g v-if="activity === 'speaking' && !small" class="fx talkwaves">
        <path class="line thin" d="M170 94q8 9 0 18" />
        <path
          class="line thin"
          d="M180 88q13 15 0 30"
          style="animation-delay: 0.3s"
        />
      </g>
    </svg>
    <Transition name="orb-say">
      <p
        v-if="bubble"
        :key="bubble"
        class="orb-say"
        :class="'say-' + bubbleSide"
        role="status"
      >
        {{ bubble }}
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.ta-orb {
  position: relative;
  flex: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  border-radius: 50%;
}
.ta-orb.interactive {
  cursor: pointer;
}
.ta-orb:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 4px;
}
svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  transition:
    filter 0.6s var(--ease),
    transform 0.6s var(--spring);
}
.aura {
  transform-box: fill-box;
  transform-origin: center;
  animation: orb-aura calc(4.8s / var(--tempo, 1)) ease-in-out infinite;
}
.shadow {
  fill: var(--ink);
  opacity: 0.1;
}
.body {
  filter: drop-shadow(
    0 8px 14px color-mix(in srgb, var(--orb-c) 40%, transparent)
  );
}
.shine {
  fill: #ffffff;
  opacity: 0.5;
}
.shine.dot {
  opacity: 0.7;
}
.ink {
  fill: var(--orb-face);
}
.line {
  fill: none;
  stroke: var(--orb-face);
  stroke-width: 3.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.line.thin {
  stroke-width: 2.6;
}
.line.hair {
  stroke-width: 1.6;
  opacity: 0.5;
}
.glint {
  fill: #ffffff;
}
.tongue,
.cheeks ellipse {
  fill: var(--cheek);
}
.cheeks {
  transition: opacity 0.5s var(--ease);
}
.squish {
  transform-box: view-box;
  transform-origin: 100px 180px;
}
.is-press .squish {
  transform: scale(1.06, 0.93);
  transition: transform 0.2s var(--ease);
}
.is-poke .squish {
  animation: orb-squish 0.65s var(--spring);
}
.is-pet .squish {
  animation: orb-wiggle 1.4s ease-in-out;
}
.eye {
  transform-box: fill-box;
  transform-origin: center;
}
.eyes.blinks .eye {
  animation: orb-blink calc(5.6s / var(--tempo, 1)) var(--blink-delay, 0s)
    infinite;
}
.eyes.blinks .eye.wink {
  animation: orb-wink 6.5s 2s infinite;
}
.talk,
.yawn {
  transform-box: fill-box;
  transform-origin: center;
}
.talk {
  animation: orb-talk 0.42s ease-in-out infinite alternate;
}
.yawn {
  animation: orb-yawn 6s ease-in-out infinite;
}
.page {
  fill: var(--paper, #fffdf6);
  stroke: var(--orb-face);
  stroke-width: 1.8;
  stroke-linejoin: round;
}
.pen rect,
.pen path {
  fill: var(--accent);
  stroke: var(--orb-face);
  stroke-width: 1.4;
}
.halo circle {
  fill: none;
  stroke: var(--orb-b);
  stroke-width: 2;
  stroke-dasharray: 3 9;
  opacity: 0.85;
  transform-box: view-box;
  transform-origin: 100px 112px;
  animation: orb-spin 26s linear infinite;
}
.halo .halo-soft {
  stroke-dasharray: none;
  stroke-width: 10;
  opacity: 0.18;
  animation: orb-breathe 5s ease-in-out infinite;
}
.fx .sparkle {
  fill: var(--particle);
  stroke: color-mix(in srgb, var(--accent) 50%, transparent);
  stroke-width: 0.8;
  transform-box: fill-box;
  transform-origin: center;
  animation: orb-twinkle 2.4s ease-in-out infinite;
}
.fx .heart {
  fill: var(--cheek);
  opacity: 0.85;
  transform-box: fill-box;
  transform-origin: center;
  animation: orb-rise 3.6s ease-out infinite;
}
.fx .cloud {
  fill: color-mix(in srgb, var(--orb-c) 55%, #ffffff);
  animation: orb-float 3.5s ease-in-out infinite alternate;
}
.storm .cloud {
  fill: color-mix(in srgb, var(--orb-c) 75%, #444);
}
.drop {
  stroke: var(--orb-c);
  stroke-width: 2.2;
  stroke-linecap: round;
  animation: orb-drop 1.35s linear infinite;
}
.scribble {
  fill: none;
  stroke: var(--orb-c);
  stroke-width: 2.4;
  stroke-linecap: round;
  animation: orb-float 0.9s ease-in-out infinite alternate;
}
.zz {
  font: 700 13px/1 var(--font-display);
  fill: var(--orb-face);
  opacity: 0.7;
  transform-box: fill-box;
  animation: orb-z 3.2s ease-in-out infinite;
}
[data-mood="night"] .zz {
  fill: var(--ink);
}
.moon {
  fill: #fff4c2;
  filter: drop-shadow(0 0 6px rgb(255 240 180 / 0.6));
}
.floating-page {
  animation: orb-float 3s ease-in-out infinite alternate;
}
.think .puff {
  fill: var(--surface-strong);
  stroke: var(--line);
  stroke-width: 1.2;
}
.think .dot {
  fill: var(--orb-face);
  transform-box: fill-box;
  animation: orb-dots 1.1s ease-in-out infinite;
}
.talkwaves path {
  stroke: var(--accent);
  animation: pulse-soft 1.2s ease-in-out infinite;
}
.orb-say {
  position: absolute;
  z-index: 3;
  left: 50%;
  bottom: 92%;
  width: max-content;
  max-width: min(260px, 70vw);
  margin: 0;
  padding: 8px 14px;
  border-radius: 16px 16px 16px 4px;
  background: var(--surface-strong);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  pointer-events: none;
}
.orb-say.say-left {
  left: auto;
  right: 88%;
  bottom: 56%;
  border-radius: 16px 16px 4px 16px;
}
.orb-say-enter-active {
  transition:
    opacity 0.25s var(--ease),
    transform 0.4s var(--spring);
}
.orb-say-leave-active {
  transition: opacity 0.2s;
}
.orb-say-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.9);
}
.orb-say-leave-to {
  opacity: 0;
}
@keyframes orb-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.12);
  }
}
@keyframes orb-wink {
  0%,
  86%,
  100% {
    transform: scaleY(1);
  }
  90%,
  94% {
    transform: scaleY(0.12);
  }
}
@keyframes orb-squish {
  0% {
    transform: scale(1);
  }
  18% {
    transform: scale(1.2, 0.76);
  }
  42% {
    transform: scale(0.9, 1.12);
  }
  66% {
    transform: scale(1.05, 0.96);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes orb-wiggle {
  0%,
  100% {
    transform: rotate(0);
  }
  15% {
    transform: rotate(-6deg);
  }
  35% {
    transform: rotate(5deg);
  }
  55% {
    transform: rotate(-4deg);
  }
  75% {
    transform: rotate(2deg);
  }
}
@keyframes orb-aura {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.04);
    opacity: 1;
  }
}
@keyframes orb-breathe {
  0%,
  100% {
    opacity: 0.12;
  }
  50% {
    opacity: 0.28;
  }
}
@keyframes orb-talk {
  from {
    transform: scaleY(0.45);
  }
  to {
    transform: scaleY(1.1);
  }
}
@keyframes orb-yawn {
  0%,
  70%,
  100% {
    transform: scale(0.7);
  }
  80%,
  88% {
    transform: scale(1.35);
  }
}
@keyframes orb-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes orb-twinkle {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.45);
    opacity: 0.35;
  }
}
@keyframes orb-rise {
  0% {
    transform: translateY(0) scale(1);
    opacity: 0.85;
  }
  70% {
    opacity: 0.5;
  }
  100% {
    transform: translateY(-26px) scale(1.15);
    opacity: 0;
  }
}
@keyframes orb-drop {
  0% {
    transform: translateY(0);
    opacity: 0.9;
  }
  100% {
    transform: translateY(16px);
    opacity: 0;
  }
}
@keyframes orb-z {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 0.7;
  }
  100% {
    transform: translate(10px, -16px) scale(1.15);
    opacity: 0;
  }
}
@keyframes orb-dots {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}
@keyframes orb-float {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-4px);
  }
}
</style>
