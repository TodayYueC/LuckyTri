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
  background: color-mix(in srgb, var(--ink) 22%, transparent);
  backdrop-filter: blur(3px);
}
.sheet {
  display: flex;
  flex-direction: column;
  width: min(var(--sheet-w), 100vw);
  height: 100%;
  background: var(--surface-strong);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow);
  outline: none;
}
.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 24px 14px;
  border-bottom: 1px solid var(--line);
}
.sheet-head h2 {
  font-size: 19px;
}
.sheet-body {
  flex: 1;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 18px 24px 28px;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.25s var(--ease);
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.4s var(--spring);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateX(40px);
}
@media (max-width: 760px) {
  .sheet-layer {
    align-items: flex-end;
  }
  .sheet {
    width: 100vw;
    height: min(88dvh, 100%);
    border-left: none;
    border-top: 1px solid var(--line);
    border-radius: 22px 22px 0 0;
  }
  .sheet-enter-from .sheet,
  .sheet-leave-to .sheet {
    transform: translateY(40px);
  }
}
</style>
