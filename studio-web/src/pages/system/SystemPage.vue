<script setup lang="ts">
import { t } from "../../i18n";
import { ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import Tabs from "../../components/ui/Tabs.vue";
import ConnectQQ from "./ConnectQQ.vue";
import ModelLibrary from "./ModelLibrary.vue";
import Runtime from "./Runtime.vue";
import SearchProfile from "./SearchProfile.vue";
import BackupManager from "./BackupManager.vue";
import { ask } from "../../dialog";
import PasswordSettings from "../../components/PasswordSettings.vue";
import UpdateSettings from "./UpdateSettings.vue";
import StickerLibrary from "./StickerLibrary.vue";
import MediaSettings from "./MediaSettings.vue";
import VoiceSettings from "./VoiceSettings.vue";

const VIEWS = ["connect", "models", "stickers", "media", "settings", "storage"];
// Older links named the settings page "runtime" and search "search".
const alias = (sub: string) =>
  sub === "runtime" ? "settings" : sub === "search" ? "models" : sub;
const view = ref(
  VIEWS.includes(alias(studio.sub)) ? alias(studio.sub) : "connect",
);
async function switchView(next: string) {
  if (next === view.value) return;
  if (
    studio.dirty &&
    !(await ask(t("当前设置还没保存，离开这个分区吗？"), {
      title: t("未保存的修改"),
      confirmText: t("放弃修改"),
      cancelText: t("继续编辑"),
    }))
  )
    return;
  studio.dirty = false;
  view.value = next;
}

watch(view, (next) => setSub(next));
watch(
  () => studio.sub,
  (sub) => {
    if (VIEWS.includes(alias(sub))) view.value = alias(sub);
  },
);
</script>

<template>
  <div class="page system">
    <Tabs
      :model-value="view"
      @update:model-value="switchView"
      :label="t('系统的分区')"
      :items="[
        { key: 'connect', label: t('连接 QQ') },
        { key: 'models', label: t('模型库') },
        { key: 'stickers', label: t('表情包') },
        { key: 'media', label: t('语音与媒体') },
        { key: 'settings', label: t('运行设置') },
        { key: 'storage', label: t('数据与备份') },
      ]"
    />
    <ConnectQQ v-if="view === 'connect'" @open="switchView" />
    <template v-else-if="view === 'models'"
      ><ModelLibrary /><SearchProfile
    /></template>
    <StickerLibrary v-else-if="view === 'stickers'" />
    <template v-else-if="view === 'media'"
      ><MediaSettings /><VoiceSettings
    /></template>
    <template v-else-if="view === 'settings'"
      ><Runtime /><UpdateSettings /><PasswordSettings
    /></template>
    <BackupManager v-else />
  </div>
</template>

<style scoped>
@layer components {
  .system {
    display: grid;
    gap: var(--gap);
  }
  .system > .tabs {
    justify-self: start;
    padding: 5px;
    border: 1px solid rgb(255 255 255 / 0.8);
    box-shadow:
      inset 0 1px 0 white,
      0 10px 30px -24px var(--accent);
    backdrop-filter: blur(22px) saturate(1.7);
  }
  .system > :deep(.tabs button) {
    padding: 9px 18px;
    border-radius: 999px;
    transition:
      transform 0.35s var(--spring),
      background-color 0.2s,
      box-shadow 0.2s;
  }
  .system > :deep(.tabs button:hover) {
    transform: translateY(-2px) scale(1.03);
  }
  .system :deep(.connect .step),
  .system :deep(.connect .checks li) {
    border: 1px solid rgb(255 255 255 / 0.85);
    border-radius: 22px;
    background:
      linear-gradient(145deg, rgb(255 255 255 / 0.68), rgb(255 255 255 / 0.28)),
      var(--surface);
    box-shadow:
      inset 0 1px 0 white,
      0 12px 24px -24px var(--accent);
    backdrop-filter: blur(18px) saturate(1.55);
    transition:
      transform 0.35s var(--spring),
      box-shadow 0.25s;
  }
  .system :deep(.connect .step:hover),
  .system :deep(.connect .checks li:hover) {
    transform: translateY(-3px);
    box-shadow:
      inset 0 1px 0 white,
      0 16px 28px -21px var(--accent);
  }
  .system :deep(.connect .num) {
    background: linear-gradient(
      145deg,
      white,
      color-mix(in srgb, var(--glow-a) 75%, white)
    );
    border: 1px solid white;
    box-shadow:
      inset 0 1px 0 white,
      0 5px 14px -9px var(--accent);
    color: var(--accent);
  }
  @keyframes system-bob {
    to {
      transform: translateY(22px) scale(1.08);
    }
  }
  @media (max-width: 760px) {
  }
}
</style>
