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
  if (open.value && root.value && !root.value.contains(event.target as Node))
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
    <Transition name="pop">
      <div
        v-if="open || inline"
        class="theme-menu"
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
    </Transition>
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
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 30;
  display: grid;
  gap: 2px;
  width: 250px;
  padding: 8px;
  border-radius: 20px;
  background: var(--surface-strong);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.inline .theme-menu {
  position: static;
  width: 100%;
  box-shadow: none;
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
  background: var(--accent-soft);
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
