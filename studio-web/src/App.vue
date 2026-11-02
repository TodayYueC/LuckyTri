<script setup lang="ts">
import { locale, t } from "./i18n";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { followHash, reload, studio } from "./stores/studio";
import { presence, refreshPresence, watchPresence } from "./stores/presence";
import { subscribe } from "./sse";
import { clearReads, expireReads, toast } from "./api";
import { applyTheme, liveMood } from "./mood/useMood";
import { loadWallpapers } from "./wallpaper";
import MoodSky from "./components/sky/MoodBackdrop.vue";
import TaOrb from "./components/ta/TaOrb.vue";
import Confirm from "./components/ui/Confirm.vue";
import { preloadPage } from "./pages";
import StudioShell from "./components/shell/StudioShell.vue";
import AccessGate from "./components/AccessGate.vue";

applyTheme();

let pulseTimer = 0;
let streamStarted = false;
const streamAbort = new AbortController();
let stopPresence = () => {};
const refreshing = ref(false);

// Server changes arrive in bursts; each follower gets its own pace.
function onServerChange(value: unknown) {
  if (!streamStarted) {
    streamStarted = true;
    if ((value as { revision?: number })?.revision === studio.core?.revision)
      return;
  }
  if (!pulseTimer) {
    expireReads();
    pulseTimer = window.setTimeout(() => {
      pulseTimer = 0;
      if (document.hidden) return;
      // A navigation may have read halfway through this burst. Expire again
      // at its trailing refresh so later events aren't hidden by that read.
      expireReads();
      void refreshPresence();
      if (!studio.dirty && studio.page !== "chats")
        void reload().catch(() => {});
      studio.pulse += 1;
    }, 2000);
  }
}

async function refresh() {
  if (refreshing.value) return;
  if (studio.dirty) {
    toast(t("请先保存草稿"));
    return;
  }
  refreshing.value = true;
  try {
    clearReads();
    await Promise.all([reload(), refreshPresence()]);
    studio.tick += 1;
  } finally {
    refreshing.value = false;
  }
}

// The server words its own labels in the page's language, so a switch asks
// for them again. Unsaved drafts are never replaced: they keep their values
// and the labels catch up on the next refresh.
watch(locale, async () => {
  clearReads();
  if (!studio.core || studio.dirty) return;
  try {
    await Promise.all([reload(), refreshPresence()]);
    studio.tick += 1;
  } catch {
    /* The next refresh tries again. */
  }
});

function reloadPage() {
  window.location.reload();
}
function visibleAgain() {
  document.documentElement.dataset.visibility = document.hidden
    ? "hidden"
    : "visible";
  if (!document.hidden) {
    expireReads();
    if (!studio.dirty && studio.page !== "chats") void reload().catch(() => {});
    studio.pulse++;
  }
}

onMounted(async () => {
  void loadWallpapers();
  followHash();
  window.addEventListener("hashchange", followHash);
  window.addEventListener("popstate", followHash);
  void preloadPage(studio.page).catch(() => {});
  try {
    await reload();
  } catch (error) {
    studio.error = (error as Error).message;
    return;
  }
  stopPresence = watchPresence();
  document.addEventListener("visibilitychange", visibleAgain);
  void subscribe(onServerChange, { signal: streamAbort.signal });
});

onUnmounted(() => {
  window.removeEventListener("hashchange", followHash);
  window.removeEventListener("popstate", followHash);
  streamAbort.abort();
  clearTimeout(pulseTimer);
  stopPresence();
  document.removeEventListener("visibilitychange", visibleAgain);
});
</script>
<template>
  <AccessGate>
    <MoodSky />
    <div v-if="studio.error" class="startup" role="alert"><TaOrb mood="blue" :size="100" /><h1>{{ t('暂未连接') }}</h1><p>{{ studio.error }}</p><button class="primary" @click="reloadPage">{{ t('重新连接') }}</button></div>
    <StudioShell v-else-if="studio.core && studio.health" :refreshing="refreshing" @refresh="refresh" />
    <div v-else class="startup" role="status"><TaOrb :mood="liveMood" activity="idle" :size="100" /><h1>{{ t('正在载入') }}</h1><p>{{ t('连接会话与记忆…') }}</p></div>
    <Confirm />
  </AccessGate>
</template>
<style scoped>
.startup{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px;text-align:center;}
.startup h1{font-size:25px;font-weight:500;}
.startup p{max-width:520px;color:var(--ink-soft);overflow-wrap:anywhere;}
</style>
