<script setup lang="ts">
import { t } from "../../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  useId,
  watch,
} from "vue";

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    options: { value: string | number; label: string; disabled?: boolean }[];
    id?: string;
    name?: string;
    ariaLabel?: string;
    disabled?: boolean;
  }>(),
  { modelValue: "", id: "", name: "", ariaLabel: "", disabled: false },
);
const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [event: Event];
}>();

const open = ref(false);
const root = ref<HTMLElement>();
const face = ref<HTMLButtonElement>();
const native = ref<HTMLSelectElement>();
const menu = ref<HTMLElement>();
const menuId = useId();
const cursor = ref(0);
const box = ref({
  top: 0,
  bottom: 0,
  left: 0,
  width: 220,
  maxHeight: 280,
  upward: false,
});
const choices = computed(() =>
  props.options.filter((option) => !option.disabled),
);
const current = computed(
  () =>
    props.options.find(
      (option) => String(option.value) === String(props.modelValue),
    )?.label ||
    choices.value[0]?.label ||
    t("请选择"),
);

function place() {
  const rect = face.value?.getBoundingClientRect();
  if (!rect) return;
  const longest = props.options.reduce(
    (max, option) => Math.max(max, String(option.label || "").length),
    0,
  );
  const width = Math.min(
    window.innerWidth - 16,
    Math.max(rect.width, Math.min(longest * 15 + 32, 420), 220),
  );
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const gap = 6;
  const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
  const spaceAbove = rect.top - gap - 8;
  const upward = spaceBelow < 220 && spaceAbove > spaceBelow;
  box.value = {
    top: rect.bottom + gap,
    bottom: window.innerHeight - rect.top + gap,
    left,
    width,
    maxHeight: Math.max(96, Math.min(320, upward ? spaceAbove : spaceBelow)),
    upward,
  };
}

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) place();
}

function focusOption() {
  const option =
    menu.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')[
      cursor.value
    ];
  option?.focus({ preventScroll: true });
  option?.scrollIntoView({ block: "nearest" });
}
function onKey(event: KeyboardEvent) {
  if (event.key === "Tab") {
    open.value = false;
    return;
  }
  if (
    !["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
      event.key,
    )
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    open.value = false;
    face.value?.focus();
    return;
  }
  if (!choices.value.length) return;
  if (event.key === "Enter" || event.key === " ") {
    choose(choices.value[cursor.value].value);
    return;
  }
  cursor.value =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.value.length - 1
        : (cursor.value +
            (event.key === "ArrowUp" ? -1 : 1) +
            choices.value.length) %
          choices.value.length;
  focusOption();
}
function faceKey(event: KeyboardEvent) {
  if (["ArrowDown", "ArrowUp"].includes(event.key) && !open.value) {
    event.preventDefault();
    toggle();
  }
}

function choose(value: string | number) {
  const next = String(value);
  open.value = false;
  if (!native.value) {
    emit("update:modelValue", next);
    return;
  }
  native.value.value = next;
  const event = new Event("change", { bubbles: true });
  native.value.dispatchEvent(event);
  face.value?.focus();
}

function outside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node))
    open.value = false;
}

function onScroll() {
  if (open.value) place();
}

function stopListening() {
  document.removeEventListener("pointerdown", outside);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  document.removeEventListener("keydown", onKey, true);
}
watch(open, async (value) => {
  stopListening();
  if (!value) return;
  cursor.value = Math.max(
    0,
    choices.value.findIndex(
      (option) => String(option.value) === String(props.modelValue),
    ),
  );
  document.addEventListener("pointerdown", outside);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  document.addEventListener("keydown", onKey, true);
  await nextTick();
  if (open.value) focusOption();
});
watch(
  () => props.disabled,
  (value) => {
    if (value) open.value = false;
  },
);
onDeactivated(() => {
  open.value = false;
  stopListening();
});
onBeforeUnmount(stopListening);
</script>

<template>
  <div ref="root" class="menu-select" :class="{ open, disabled }">
    <button
      ref="face"
      type="button"
      class="menu-face"
      :id="menuId + '-face'"
      role="combobox"
      aria-haspopup="listbox"
      :aria-controls="menuId"
      :aria-activedescendant="
        open && choices.length ? menuId + '-' + cursor : undefined
      "
      :aria-label="ariaLabel || undefined"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
      @keydown="faceKey"
    >
      <span>{{ current }}</span>
      <i aria-hidden="true"></i>
    </button>
    <Teleport to="body">
      <ul
        v-if="open"
        ref="menu"
        :id="menuId"
        class="menu-list"
        :class="{ up: box.upward }"
        role="listbox"
        :aria-labelledby="menuId + '-face'"
        @pointerdown.stop
        :style="{
          top: box.upward ? 'auto' : box.top + 'px',
          bottom: box.upward ? box.bottom + 'px' : 'auto',
          left: box.left + 'px',
          width: box.width + 'px',
          maxHeight: box.maxHeight + 'px',
        }"
      >
        <li v-for="(option, index) in choices" :key="String(option.value)">
          <button
            type="button"
            role="option"
            :id="menuId + '-' + index"
            :tabindex="index === cursor ? 0 : -1"
            :aria-selected="String(option.value) === String(modelValue)"
            @click="choose(option.value)"
          >
            {{ option.label }}
          </button>
        </li>
        <li v-if="!choices.length" class="empty">{{ t("没有可选项") }}</li>
      </ul>
    </Teleport>
    <select
      ref="native"
      class="native"
      :id="id || undefined"
      :name="name || undefined"
      :value="modelValue"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      @change="
        open = false;
        emit('update:modelValue', ($event.target as HTMLSelectElement).value);
        emit('change', $event);
      "
    >
      <option
        v-for="option in options"
        :key="'n-' + String(option.value)"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.menu-select {
  position: relative;
  min-width: 0;
}
.menu-face {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  padding: 8px 12px;
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.72), rgb(255 255 255 / 0.4)),
    var(--surface-strong);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-sheen);
  text-align: left;
}
.menu-face span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-face i {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--ink-soft);
  border-bottom: 1.5px solid var(--ink-soft);
  transform: translateY(-2px) rotate(45deg);
}
.menu-list {
  position: fixed;
  z-index: 200;
  display: grid;
  max-height: 280px;
  margin: 0;
  padding: 6px;
  overflow: auto;
  list-style: none;
  border-radius: 16px;
  background: var(--surface-strong);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-sheen), var(--shadow);
  transform-origin: top center;
  animation: menu-pop 460ms var(--jelly) both;
}
.menu-list.up {
  transform-origin: bottom center;
}
@keyframes menu-pop {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.92, 0.82);
  }
  70% {
    opacity: 1;
    transform: translateY(-2px) scale(1.02, 1.04);
  }
  100% {
    transform: none;
  }
}
.menu-list button {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  font-weight: 550;
  white-space: nowrap;
}
.menu-list button[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--ink);
}
.empty {
  padding: 8px 10px;
  color: var(--ink-soft);
  font-size: 13px;
}
.menu-list button:hover:not(:disabled) {
  transform: none;
  box-shadow: none;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.native {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
