<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { MOODS, MOOD_KEYS, type MoodKey } from "../../mood/themes";
import { liveMood, pinTheme, theme } from "../../mood/useMood";

withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });
const open = ref(false);
const root = ref<HTMLElement>();

function choose(key: MoodKey | null) {
  pinTheme(key);
  open.value = false;
}

function outside(event: PointerEvent) {
  if (
    open.value &&
    root.value &&
    !root.value.contains(event.target as Node) &&
    !(event.target as Element).closest(".theme-menu")
  )
    open.value = false;
}

onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div
    ref="root"
    class="theme-picker"
    :class="{ inline }"
    @keydown.esc="open = false"
  >
    <button
      v-if="!inline"
      class="theme-toggle"
      type="button"
      :aria-expanded="open"
      aria-haspopup="true"
      :title="
        theme.pinned
          ? `主题固定为「${MOODS[theme.pinned].label}」`
          : '主题跟随 TA 的心情'
      "
      @click="open = !open"
    >
      <span
        class="swatch"
        :data-mood="theme.pinned ?? liveMood"
        aria-hidden="true"
      ></span>
      <span class="rail-label">
        {{
          theme.pinned
            ? `固定：${MOODS[theme.pinned].label}`
            : `跟随 TA · ${MOODS[liveMood].label}`
        }}
      </span>
    </button>
    <Teleport to="body" :disabled="inline"
      ><Transition name="pop">
        <div
          v-if="open || inline"
          class="theme-menu"
          :class="{ 'inline-menu': inline }"
          role="radiogroup"
          aria-label="界面主题"
        >
          <button
            type="button"
            role="radio"
            data-theme-choice="auto"
            :aria-checked="!theme.pinned"
            @click="choose(null)"
          >
            <span
              class="swatch auto"
              :data-mood="liveMood"
              aria-hidden="true"
            ></span>
            <span
              ><b>跟随 TA 的心情</b
              ><small>现在是「{{ MOODS[liveMood].label }}」</small></span
            >
          </button>
          <button
            v-for="key in MOOD_KEYS"
            :key="key"
            type="button"
            role="radio"
            :data-theme-choice="key"
            :aria-checked="theme.pinned === key"
            @click="choose(key)"
          >
            <span class="swatch" :data-mood="key" aria-hidden="true"></span>
            <span
              ><b>{{ MOODS[key].label }}</b
              ><small>{{ MOODS[key].feel }}</small></span
            >
          </button>
        </div>
      </Transition></Teleport
    >
  </div>
</template>

<style scoped>
.theme-picker {
  position: relative;
}
.theme-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--ink-soft);
  border-radius: 14px;
  text-align: left;
}
.theme-toggle:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.swatch {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 36% 30%,
    var(--orb-a),
    var(--orb-b) 58%,
    var(--orb-c)
  );
  box-shadow:
    0 0 0 2px var(--surface-strong),
    0 0 0 3px var(--line);
}
.swatch.auto {
  background: conic-gradient(
    #ffc15f,
    #ffa8cf,
    #7fdcbc,
    #99b2d8,
    #9a8cc4,
    #cdb6f7,
    #6f7ee6,
    #ffc15f
  );
}
.theme-menu {
  position: fixed;
  top: 96px;
  right: 28px;
  z-index: 80;
  display: grid;
  gap: 2px;
  width: 250px;
  max-height: calc(100dvh - 64px);
  overflow: auto;
  padding: 8px;
  border-radius: 28px;
  background:
    radial-gradient(ellipse at 0% 0%, rgb(255 255 255 / 0.93), transparent 52%),
    linear-gradient(145deg, rgb(255 255 255 / 0.72), rgb(237 243 255 / 0.37)),
    var(--glass-fill);
  border: 1.5px solid rgb(255 255 255 / 0.85);
  box-shadow:
    inset 0 2px 1px white,
    0 24px 58px -27px rgb(52 82 149 / 0.4);
  backdrop-filter: blur(30px) saturate(1.8);
}
.theme-menu.inline-menu {
  position: static;
  width: 100%;
  box-shadow: none;
}
@media (min-width: 761px) and (max-width: 1100px) {
  .theme-menu {
    right: 20px;
  }
}
.theme-menu button {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: none;
  border-radius: 14px;
  background: transparent;
  text-align: left;
  font-weight: 500;
}
.theme-menu button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  transform: none;
  box-shadow: none;
}
.theme-menu button[aria-checked="true"] {
  background: linear-gradient(
    120deg,
    rgb(255 255 255 / 0.87),
    color-mix(in srgb, var(--glow-a) 40%, white)
  );
  box-shadow:
    inset 0 1px 0 white,
    0 8px 18px -13px var(--accent);
}
.theme-menu button > span:last-child {
  display: grid;
  line-height: 1.35;
}
.theme-menu b {
  font-size: 13px;
}
.theme-menu small {
  font-size: 11.5px;
  color: var(--ink-soft);
}
.pop-enter-active {
  transition:
    opacity 0.2s var(--ease),
    transform 0.3s var(--spring);
}
.pop-leave-active {
  transition: opacity 0.15s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
