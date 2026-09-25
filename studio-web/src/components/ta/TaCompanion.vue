<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import TaOrb from "./TaOrb.vue";
import TaChat from "./TaChat.vue";
import { presence } from "../../stores/presence";
import { studio } from "../../stores/studio";
import { liveMood } from "../../mood/useMood";

defineProps<{ hideOrb?: boolean }>();

const drawer = ref<HTMLElement>();
const activity = computed(() => presence.data?.activity?.kind || "idle");
const name = computed(() => presence.data?.name || "TA");

watch(
  () => studio.chatOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    drawer.value?.querySelector<HTMLInputElement>("input[name=text]")?.focus();
  },
);
</script>

<template>
  <div class="companion">
    <Transition name="scrim">
      <button
        v-if="studio.chatOpen"
        class="scrim"
        type="button"
        aria-label="收起聊天"
        @click="studio.chatOpen = false"
      ></button>
    </Transition>
    <Transition name="drawer">
      <section
        v-if="studio.chatOpen"
        ref="drawer"
        class="ta-drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="`和 ${name} 聊聊（试聊）`"
        @keydown.esc="studio.chatOpen = false"
      >
        <header class="drawer-head">
          <TaOrb :mood="liveMood" :activity="activity" :size="42" />
          <div class="drawer-title">
            <h2>和 {{ name }} 聊聊</h2>
            <span class="chip" data-tone="quiet">试聊 · 什么都不写入</span>
          </div>
          <button
            class="icon-button ghost"
            aria-label="收起聊天"
            @click="studio.chatOpen = false"
          >
            ✕
          </button>
        </header>
        <TaChat :sessions="studio.core?.sessions || []" />
      </section>
    </Transition>
    <div v-if="!hideOrb && !studio.chatOpen" class="companion-dock">
      <button
        class="companion-talk"
        :aria-expanded="studio.chatOpen"
        @click="studio.chatOpen = !studio.chatOpen"
      >
        {{ studio.chatOpen ? "收起" : "聊聊" }}
      </button>
      <TaOrb
        :mood="liveMood"
        :activity="activity"
        :size="44"
        interactive
        bubble-side="left"
        @open-chat="studio.chatOpen = true"
      />
    </div>
  </div>
</template>

<style scoped>
.companion {
  position: fixed;
  right: 18px;
  bottom: 16px;
  z-index: 80;
  display: grid;
  justify-items: end;
  gap: 10px;
  pointer-events: none;
}
.companion > * {
  pointer-events: auto;
}
.companion-dock {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.companion-talk {
  margin-bottom: 14px;
  padding: 6px 12px;
  font-size: 12px;
  opacity: 1;
  transform: none;
  transition:
    opacity 0.25s var(--ease),
    transform 0.3s var(--spring);
}
.companion-dock:hover .companion-talk,
.companion-talk:focus-visible,
.companion-talk[aria-expanded="true"] {
  opacity: 1;
  transform: none;
}
/* Without hover, the way into the chat must stay visible. */
@media (hover: none) {
  .companion-talk {
    opacity: 1;
    transform: none;
  }
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 1;
  width: 100vw;
  height: 100dvh;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: color-mix(in srgb, var(--ink) 32%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: none;
  cursor: pointer;
}
.scrim:hover:not(:disabled),
.scrim:active:not(:disabled) {
  transform: none;
  border: none;
  box-shadow: none;
}
.scrim-enter-active,
.scrim-leave-active {
  transition: opacity 0.2s var(--ease);
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
.ta-drawer {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(460px, calc(100vw - 28px));
  height: min(640px, calc(100dvh - 140px));
  padding: 16px 18px 18px;
  border-radius: 34px;
  background:
    radial-gradient(ellipse at 0% 0%, rgb(255 255 255 / 0.92), transparent 50%),
    linear-gradient(
      145deg,
      rgb(255 255 255 / 0.72),
      rgb(235 243 255 / 0.43) 65%,
      rgb(248 232 251 / 0.58)
    ),
    var(--glass-fill);
  border: 1.5px solid rgb(255 255 255 / 0.87);
  box-shadow:
    inset 0 2px 1px white,
    0 28px 64px -27px rgb(52 82 149 / 0.42);
  backdrop-filter: blur(34px) saturate(1.8);
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer-title {
  flex: 1;
  display: grid;
  justify-items: start;
  gap: 3px;
}
.drawer-head h2 {
  font-size: 16px;
}
.drawer-enter-active {
  transition:
    opacity 0.28s var(--ease),
    transform 0.55s var(--spring);
}
.drawer-leave-active {
  transition:
    opacity 0.18s,
    transform 0.2s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateY(34px) scale(0.88) rotate(2deg);
  transform-origin: bottom right;
}
@media (max-width: 760px) {
  .companion {
    right: 12px;
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
  .companion-dock :deep(.ta-orb) {
    width: 58px !important;
    height: 58px !important;
  }
  .companion-talk {
    margin-bottom: 10px;
    padding: 5px 10px;
  }
  .ta-drawer {
    height: min(520px, calc(100dvh - 190px));
  }
}

.drawer-head :deep(.ta-orb) {
  flex: 0 0 42px;
}
.drawer-head {
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.ta-drawer :deep(.ta-chat) {
  min-height: 0;
  overflow: hidden;
}
.companion-dock {
  padding: 5px 10px;
  border: 1.5px solid rgb(255 255 255 / 0.88);
  background:
    linear-gradient(140deg, rgb(255 255 255 / 0.82), rgb(232 242 255 / 0.42)),
    var(--glass-fill);
  border-radius: 999px;
  box-shadow:
    inset 0 2px 1px white,
    0 15px 28px -17px rgb(52 82 149 / 0.38);
  backdrop-filter: blur(22px) saturate(1.75);
  align-items: center;
  transition:
    transform 420ms var(--spring),
    box-shadow 320ms ease;
}
.companion-dock:hover {
  transform: translateY(-5px) scale(1.035);
  box-shadow:
    inset 0 2px 1px white,
    0 23px 32px -17px rgb(52 82 149 / 0.45);
}
.companion-talk {
  margin: 0;
  border: 0;
  background: transparent;
}
@media (max-width: 760px) {
  .companion-dock :deep(.ta-orb) {
    width: 36px !important;
    height: 36px !important;
  }
  .companion-talk {
    margin: 0;
  }
}
</style>
