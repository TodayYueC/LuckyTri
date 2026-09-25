<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    eyebrow?: string;
    width?: string;
  }>(),
  { eyebrow: "", width: "520px" },
);
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let returnTo: HTMLElement | null = null;

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnTo = document.activeElement as HTMLElement | null;
      document.addEventListener("keydown", onKey);
      await nextTick();
      panel.value?.focus();
    } else {
      document.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-layer" @click.self="emit('close')">
        <aside
          ref="panel"
          class="sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          :style="{ '--sheet-w': width }"
        >
          <header class="sheet-head">
            <div>
              <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
              <h2>{{ title }}</h2>
            </div>
            <button
              class="icon-button ghost sheet-close"
              aria-label="关闭"
              @click="emit('close')"
            >
              ✕
            </button>
          </header>
          <div class="sheet-body"><slot /></div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  padding: 12px;
  background: color-mix(in srgb, var(--sky-top) 42%, rgb(60 81 137 / 0.27));
  backdrop-filter: blur(13px) saturate(1.3);
}
.sheet {
  display: flex;
  flex-direction: column;
  width: min(var(--sheet-w), calc(100vw - 24px));
  height: 100%;
  border-radius: 34px;
  background:
    radial-gradient(ellipse at 0% 0%, rgb(255 255 255 / 0.95), transparent 43%),
    linear-gradient(
      145deg,
      rgb(255 255 255 / 0.73),
      rgb(236 244 255 / 0.45) 62%,
      rgb(246 234 251 / 0.6)
    ),
    var(--glass-fill);
  border: 1.5px solid rgb(255 255 255 / 0.88);
  box-shadow:
    inset 0 2px 1px white,
    inset -1px -2px 2px rgb(112 143 210 / 0.13),
    0 32px 75px -28px rgb(52 82 149 / 0.44);
  backdrop-filter: blur(36px) saturate(1.8);
  outline: none;
}
.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 26px 28px 18px;
  border-bottom: 1px solid rgb(255 255 255 / 0.67);
}
.sheet-head h2 {
  font-size: 19px;
}
.sheet-body {
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 20px 28px 30px;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s var(--ease);
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.55s var(--spring);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateX(74px) scale(0.94);
}
@media (max-width: 760px) {
  .sheet-layer {
    align-items: flex-end;
    padding: 0;
  }
  .sheet {
    width: 100vw;
    height: min(88dvh, 100%);
    border-radius: 30px 30px 0 0;
  }
  .sheet-enter-from .sheet,
  .sheet-leave-to .sheet {
    transform: translateY(40px);
  }
}
</style>
