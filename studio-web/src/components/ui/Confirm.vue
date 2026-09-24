<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { dialogs, settle } from "../../dialog";

const current = computed(() => dialogs.queue[0] || null);
const value = ref("");
const input = ref<HTMLInputElement>();
const confirmButton = ref<HTMLButtonElement>();
let returnTo: HTMLElement | null = null;

watch(current, async (next, previous) => {
  if (next && !previous)
    returnTo = document.activeElement as HTMLElement | null;
  if (!next) {
    returnTo?.focus?.();
    returnTo = null;
    return;
  }
  value.value = next.value;
  await nextTick();
  if (next.kind === "prompt") input.value?.focus();
  else confirmButton.value?.focus();
});

function confirm() {
  if (!current.value) return;
  settle(current.value.kind === "prompt" ? value.value.trim() : "ok");
}
function cancel() {
  settle(null);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="current" class="dialog-layer" @keydown.esc.prevent="cancel">
        <form
          class="dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-label="current.title"
          @submit.prevent="confirm"
        >
          <span class="dialog-orb" aria-hidden="true"></span>
          <h2>{{ current.title }}</h2>
          <p v-if="current.message">{{ current.message }}</p>
          <input
            v-if="current.kind === 'prompt'"
            ref="input"
            v-model="value"
            :type="current.secret ? 'password' : 'text'"
            :placeholder="current.placeholder"
            :autocomplete="current.secret ? 'current-password' : 'off'"
          />
          <div class="row end">
            <button type="button" class="dialog-cancel ghost" @click="cancel">
              {{ current.cancelText }}
            </button>
            <button
              ref="confirmButton"
              type="submit"
              class="dialog-confirm"
              :class="current.danger ? 'danger' : 'primary'"
            >
              {{ current.confirmText }}
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
  backdrop-filter: blur(4px);
}
.dialog {
  position: relative;
  display: grid;
  gap: 14px;
  width: min(420px, 100%);
  padding: 34px 26px 22px;
  border-radius: var(--r-l);
  background: var(--surface-strong);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.dialog h2 {
  font-size: 18px;
}
.dialog p {
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-line;
}
.dialog-orb {
  position: absolute;
  top: -22px;
  left: 26px;
  width: 44px;
  height: 40px;
  border-radius: 50% 50% 46% 46%;
  background: radial-gradient(
    circle at 38% 30%,
    var(--orb-a),
    var(--orb-b) 60%,
    var(--orb-c)
  );
  box-shadow: 0 8px 18px -8px var(--orb-c);
}
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s var(--ease);
}
.dialog-enter-active .dialog {
  transition: transform 0.35s var(--spring);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .dialog {
  transform: translateY(12px) scale(0.96);
}
</style>
