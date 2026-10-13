<script setup lang="ts">
import { t } from "../../i18n";
import { onMounted, ref } from "vue";
import { api, toast } from "../../api";
import { studio } from "../../stores/studio";
import Toggle from "../../components/ui/Toggle.vue";

const side = ref(2048);
const mb = ref(3);
const stickers = ref(true);
const taggingModelId = ref("");
onMounted(async () => {
  try {
    const media = await api("/core/media-settings");
    side.value = media.visionMaxSide;
    mb.value = media.visionMaxMB;
    const s = await api("/core/stickers");
    stickers.value = s.settings.enabled !== false;
    taggingModelId.value = s.settings.taggingModelId || "";
  } catch (e) {
    toast((e as Error).message, true);
  }
});
async function save() {
  try {
    await api("/core/media-settings", "PUT", {
      visionMaxSide: Number(side.value),
      visionMaxMB: Number(mb.value),
    });
    await api("/core/stickers-settings", "PUT", {
      enabled: stickers.value,
      taggingModelId: taggingModelId.value,
    });
    studio.dirty = false;
    toast(t("已保存并应用"));
  } catch (e) {
    toast((e as Error).message, true);
  }
}
</script>

<template>
  <form
    class="card media"
    data-testid="media-settings"
    @submit.prevent="save"
    @change="studio.dirty = true"
  >
    <div class="card-head">
      <div>
        <span class="eyebrow">{{ t("图片与表情") }}</span>
        <h2>{{ t("TA 怎样看图、用表情") }}</h2>
      </div>
    </div>
    <div class="fields">
      <label
        >{{ t("图片理解的最长边（像素）") }}
        <input
          v-model.number="side"
          type="number"
          min="512"
          max="8192"
          step="64"
        />
        <small class="faint">{{
          t("更大的图会先缩小再交给视觉模型，避免大图失败或超时。默认 2048。")
        }}</small>
      </label>
      <label
        >{{ t("图片理解的大小上限（MB）") }}
        <input v-model.number="mb" type="number" min="0.5" max="4" step="0.5" />
        <small class="faint">{{
          t("超过时会重新压缩。部分服务商对单张图片有更严格的限制。")
        }}</small>
      </label>
      <label
        >{{ t("表情识别用的模型") }}
        <select v-model="taggingModelId">
          <option value="">{{ t("自动选择开启视觉的模型") }}</option>
          <option
            v-for="m in (studio.core.models || []).filter((m: any) => m.vision)"
            :key="m.id"
            :value="m.id"
          >
            {{ m.label || m.model || m.id }}
          </option>
        </select>
        <small class="faint">{{
          t("每张表情只识别一次，可选一个便宜的视觉模型。")
        }}</small>
      </label>
    </div>
    <div class="switches">
      <Toggle v-model="stickers" name="stickers">
        <b>{{ t("允许 TA 在聊天里用表情") }}</b>
        <small>{{ t("关掉后表情库保留，TA 不再使用。") }}</small>
      </Toggle>
    </div>
    <div class="save-bar">
      <button class="primary" type="submit">{{ t("保存") }}</button>
    </div>
  </form>
</template>

<style scoped>
.media {
  display: grid;
  gap: 16px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.fields label {
  display: grid;
  gap: 6px;
  align-content: start;
  font-size: 13px;
}
</style>
