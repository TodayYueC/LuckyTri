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
  background: color-mix(in srgb, var(--sky-top) 44%, rgb(60 81 137 / 0.24));
  backdrop-filter: blur(13px) saturate(1.25);
}
.dialog {
  position: relative;
  display: grid;
  gap: 17px;
  width: min(420px, 100%);
  padding: 42px 30px 26px;
  border-radius: 34px;
  background:
    radial-gradient(
      ellipse at 9% -10%,
      rgb(255 255 255 / 0.98),
      transparent 53%
    ),
    linear-gradient(
      148deg,
      rgb(255 255 255 / 0.76),
      rgb(229 239 255 / 0.44) 64%,
      rgb(248 231 251 / 0.55)
    ),
    var(--glass-fill);
  border: 1.5px solid rgb(255 255 255 / 0.89);
  box-shadow:
    inset 0 2px 1px white,
    0 30px 72px -28px rgb(52 82 149 / 0.43);
  backdrop-filter: blur(32px) saturate(1.7);
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
  top: -24px;
  left: 30px;
  width: 52px;
  height: 50px;
  border: 2px solid rgb(255 255 255 / 0.89);
  border-radius: 44% 56% 57% 43% / 50% 43% 57% 50%;
  background: radial-gradient(
    circle at 38% 30%,
    var(--orb-a),
    var(--orb-b) 60%,
    var(--orb-c)
  );
  box-shadow:
    inset 0 3px 3px rgb(255 255 255 / 0.88),
    0 13px 24px -9px var(--orb-c);
  animation: dialog-orb-breathe 4s ease-in-out infinite alternate;
}
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s var(--ease);
}
.dialog-enter-active .dialog {
  transition: transform 0.52s var(--spring);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .dialog {
  transform: translateY(22px) scale(0.9);
}
@keyframes dialog-orb-breathe {
  to {
    transform: translateY(-5px) rotate(8deg) scale(1.07);
  }
}
</style>
