<script setup lang="ts">
import Select from "../../components/ui/Select.vue";
import Toggle from "../../components/ui/Toggle.vue";
import { t } from "../../i18n";
import { onMounted, ref } from "vue";
import { api, toast } from "../../api";

const v = ref<any>(null);
const key = ref("");
const asrKey = ref("");
const testing = ref(false);
onMounted(async () => {
  try {
    v.value = await api("/core/voice");
  } catch (e) {
    toast((e as Error).message, true);
  }
});
async function save() {
  try {
    v.value = await api("/core/voice", "PUT", {
      ...v.value,
      ...(key.value.trim() ? { apiKey: key.value.trim() } : {}),
      ...(asrKey.value.trim() ? { asrApiKey: asrKey.value.trim() } : {}),
    });
    key.value = "";
    asrKey.value = "";
    toast(t("已保存并应用"));
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function listen() {
  testing.value = true;
  try {
    const r = await api("/core/voice/test", "POST", {});
    new Audio(`data:audio/${r.format || "mp3"};base64,${r.base64}`).play();
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <form v-if="v" class="card media" @submit.prevent="save">
    <div class="card-head">
      <div>
        <span class="eyebrow">{{ t("语音") }}</span>
        <h2>{{ t("TA 的声音") }}</h2>
      </div>
    </div>
    <p class="faint">
      {{
        t(
          "配好语音服务后才能打开。打开只是“可以”：要不要用语音、要不要唱歌，由 TA 自己决定。",
        )
      }}
    </p>
    <div class="fields">
      <label
        >{{ t("协议") }}
        <Select
          v-model="v.protocol"
          :aria-label="t('协议')"
          :options="[
            {
              value: 'volc-openspeech-v3',
              label: t('火山语音 v3（Agent Plan）'),
            },
            { value: 'openai-audio', label: t('OpenAI 兼容 /audio/speech') },
          ]"
        />
      </label>
      <label>{{ t("服务地址") }}<input v-model="v.baseUrl" /></label>
      <label
        >{{ t("API Key") }}
        <input
          v-model="key"
          type="password"
          autocomplete="off"
          :placeholder="v.hasApiKey ? t('已保存，留空不变') : ''"
        />
      </label>
      <label v-if="v.protocol === 'volc-openspeech-v3'"
        >{{ t("资源 ID") }}<input v-model="v.resourceId"
      /></label>
      <label v-else>{{ t("模型") }}<input v-model="v.model" /></label>
      <label>{{ t("TA 的音色") }}<input v-model="v.speaker" /></label>
      <label
        >{{ t("声音的样子（可选）") }}
        <input
          v-model="v.style"
          maxlength="200"
          :placeholder="t('例如：轻快、带点笑意')"
        />
      </label>
    </div>
    <h3>{{ t("听语音") }}</h3>
    <div class="fields">
      <label
        >{{ t("识别协议") }}
        <Select
          v-model="v.asrProtocol"
          :aria-label="t('识别协议')"
          :options="[
            { value: 'volc-plan-sauc', label: t('火山语音识别（Agent Plan）') },
            { value: 'volc-flash', label: t('火山录音文件极速版') },
            {
              value: 'openai-audio',
              label: t('OpenAI 兼容 /audio/transcriptions'),
            },
          ]"
        />
      </label>
      <label>{{ t("识别服务地址") }}<input v-model="v.asrBaseUrl" /></label>
      <label
        >{{ t("识别 API Key") }}
        <input
          v-model="asrKey"
          type="password"
          autocomplete="off"
          :placeholder="
            v.hasAsrApiKey ? t('已保存，留空不变') : t('留空则用上面的 Key')
          "
        />
      </label>
      <label v-if="v.asrProtocol === 'openai-audio'"
        >{{ t("识别模型") }}<input v-model="v.asrModel"
      /></label>
      <label v-else
        >{{ t("识别资源 ID") }}<input v-model="v.asrResourceId"
      /></label>
    </div>
    <div class="switches">
      <Toggle v-model="v.listen" name="listen" :disabled="!v.hearingReady">
        <b>{{ t("听懂别人发来的语音") }}</b>
        <small>{{ t("默认关闭；打开后语音会先转成文字再给 TA 看。") }}</small>
      </Toggle>
      <Toggle v-model="v.enabled" name="voice" :disabled="!v.ready">
        <b>{{ t("允许 TA 发语音") }}</b>
        <small>{{ t("默认关闭；没有可用语音服务时保持关闭。") }}</small>
      </Toggle>
    </div>
    <div class="save-bar">
      <button class="primary" type="submit">{{ t("保存") }}</button>
      <button type="button" :disabled="!v.ready || testing" @click="listen">
        {{ testing ? t("正在合成…") : t("试听") }}
      </button>
    </div>
  </form>
</template>
