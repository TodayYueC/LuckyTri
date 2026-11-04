<script setup lang="ts">
import { t } from "../../i18n";
import { ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import Tabs from "../../components/ui/SectionNav.vue";
import ConnectQQ from "./ConnectQQ.vue";
import ModelLibrary from "./ModelLibrary.vue";
import Runtime from "./Runtime.vue";
import SearchProfile from "./SearchProfile.vue";
import EmbeddingProfile from "./EmbeddingProfile.vue";
import RecallPanel from "./RecallPanel.vue";
import Segments from "../../components/ui/Tabs.vue";
import BackupManager from "./BackupManager.vue";
import { ask } from "../../dialog";
import PasswordSettings from "../../components/PasswordSettings.vue";
import UpdateSettings from "./UpdateSettings.vue";
import StickerLibrary from "./StickerLibrary.vue";
import MediaSettings from "./MediaSettings.vue";
import VoiceSettings from "./VoiceSettings.vue";

const modelSections = ["library", "embedding", "recall", "search"];
const readModelView = (sub: string) =>
  sub === "search"
    ? "search"
    : modelSections.includes(sub.split("/")[1])
      ? sub.split("/")[1]
      : "library";
const modelView = ref(readModelView(studio.sub));
async function switchModelView(next: string) {
  if (next === modelView.value) return;
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
  modelView.value = next;
  setSub(next === "library" ? "models" : "models/" + next);
}
const VIEWS = ["connect", "models", "stickers", "media", "settings", "storage"];
// Older links named the settings page "runtime" and search "search".
const alias = (sub: string) =>
  sub === "runtime"
    ? "settings"
    : sub === "search"
      ? "models"
      : sub.split("/")[0];
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

watch(view, (next) =>
  setSub(
    next === "models" && modelView.value !== "library"
      ? "models/" + modelView.value
      : next,
  ),
);
watch(
  () => studio.sub,
  (sub) => {
    if (VIEWS.includes(alias(sub))) view.value = alias(sub);
    if (alias(sub) === "models") modelView.value = readModelView(sub);
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
    <section v-else-if="view === 'models'" class="model-tools">
      <Segments
        :model-value="modelView"
        @update:model-value="switchModelView"
        :label="t('模型库')"
        :items="[
          { key: 'library', label: t('模型库') },
          { key: 'embedding', label: t('知识向量模型') },
          { key: 'recall', label: t('记忆召回') },
          { key: 'search', label: t('联网搜索') },
        ]"
      />
      <ModelLibrary v-if="modelView === 'library'" />
      <EmbeddingProfile v-else-if="modelView === 'embedding'" />
      <RecallPanel v-else-if="modelView === 'recall'" />
      <SearchProfile v-else />
    </section>
    <StickerLibrary v-else-if="view === 'stickers'" />
    <div v-else-if="view === 'media'" class="settings-grid">
      <MediaSettings /><VoiceSettings />
    </div>
    <div v-else-if="view === 'settings'" class="settings-grid">
      <Runtime /><UpdateSettings /><PasswordSettings />
    </div>
    <BackupManager v-else />
  </div>
</template>
