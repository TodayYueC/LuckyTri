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
    <Transition name="drawer">
      <section
        v-if="studio.chatOpen"
        ref="drawer"
        class="ta-drawer"
        role="dialog"
        :aria-label="`和 ${name} 聊聊（试聊）`"
        @keydown.esc="studio.chatOpen = false"
      >
        <header class="drawer-head">
          <TaOrb :mood="liveMood" :activity="activity" :size="42" />
          <div>
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
    <div v-if="!hideOrb" class="companion-dock">
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
        :size="72"
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
  z-index: 60;
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
  opacity: 0;
  transform: translateX(8px);
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
.ta-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(400px, calc(100vw - 28px));
  height: min(560px, calc(100dvh - 140px));
  padding: 16px 18px 18px;
  border-radius: var(--r-l);
  background: var(--surface-strong);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer-head > div {
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
    opacity 0.25s var(--ease),
    transform 0.4s var(--spring);
}
.drawer-leave-active {
  transition:
    opacity 0.18s,
    transform 0.2s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
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
</style>
