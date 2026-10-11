<script setup lang="ts">
import { t, N_ } from "../../i18n";
import { onMounted, reactive, ref } from "vue";
import { api, toast } from "../../api";

const draft = reactive<any>({
  enabled: false,
  label: t("知识向量"),
  baseUrl: "",
  model: "",
  apiKey: "",
  dimensions: 0,
  batchSize: 10,
  timeoutMs: 90000,
  protocol: "openai",
});
const busy = ref(false),
  dirty = ref(false),
  loaded = ref(false),
  result = ref("");
async function load() {
  try {
    Object.assign(draft, await api("/core/knowledge/embedding"), {
      apiKey: "",
    });
    loaded.value = true;
  } catch (error) {
    result.value = (error as Error).message;
  }
}
async function save() {
  busy.value = true;
  try {
    Object.assign(
      draft,
      await api("/core/knowledge/embedding", "PATCH", draft),
      { apiKey: "" },
    );
    dirty.value = false;
    toast(t("知识向量模型已保存"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function test() {
  busy.value = true;
  try {
    const data = await api("/core/knowledge/embedding/test", "POST", {});
    result.value = t("连接成功，向量维度 {dimensions}", {
      dimensions: data.dimensions,
    });
  } catch (error) {
    result.value = (error as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="card embedding-profile" aria-labelledby="embedding-title">
    <h2 id="embedding-title">{{ t("知识向量模型") }}</h2>
    <p class="muted">
      {{
        t(
          "填写任意 OpenAI 兼容向量服务（/embeddings）的请求地址、模型名和密钥。火山方舟地址可以不填模型名，会用 doubao-embedding-vision。维度填 0 表示用模型自己的长度（doubao-embedding-vision 是 2048），写明长度就按写的请求。不启用或连不上时，对话和关键词回忆照常进行。",
        )
      }}
    </p>
    <p v-if="loaded && !draft.configured" class="faint">
      {{ t("当前兼容旧配置，跟随默认模型。保存后改用独立配置。") }}
    </p>
    <form
      v-if="loaded"
      autocomplete="off"
      @submit.prevent="save"
      @input="dirty = true"
      @change="dirty = true"
    >
      <label class="check"
        ><input
          v-model="draft.enabled"
          type="checkbox"
          name="embeddingEnabled"
        />{{ t("启用知识向量") }}</label
      >
      <div class="fields">
        <label
          >{{ t("请求地址")
          }}<input
            v-model="draft.baseUrl"
            name="embeddingBaseUrl"
            type="url"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://example.com/v1"
            :required="draft.enabled"
        /></label>
        <label
          >{{ t("模型名称")
          }}<input
            v-model="draft.model"
            name="embeddingModelName"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('火山方舟可留空')"
        /></label>
        <label
          >{{ t("向量服务密钥")
          }}<input
            v-model="draft.apiKey"
            name="embeddingApiKey"
            type="text"
            class="secret"
            autocomplete="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            :placeholder="
              draft.hasApiKey ? t('已保存，留空保留') : t('填写向量服务密钥')
            "
        /></label>
      </div>
      <details>
        <summary>{{ t("自动选择的细节") }}</summary>
        <div class="fields">
          <label
            >{{ t("向量维度（0 表示自动）")
            }}<input
              v-model.number="draft.dimensions"
              name="embeddingDimensions"
              type="number"
              min="0"
              max="65536"
          /></label>
          <label
            >{{ t("每批段落数")
            }}<input
              v-model.number="draft.batchSize"
              name="embeddingBatchSize"
              type="number"
              min="1"
              max="128"
          /></label>
          <label
            >{{ t("请求格式")
            }}<select v-model="draft.protocol" name="embeddingProtocol">
              <option value="openai">{{ t("OpenAI 兼容（可批量）") }}</option>
              <option value="multimodal">
                {{ t("方舟多模态接口（逐条）") }}
              </option>
            </select></label
          >
        </div>
      </details>
      <div class="save-bar">
        <button class="primary" :disabled="busy">
          {{ t("保存向量模型") }}
        </button>
        <button
          type="button"
          :disabled="busy || dirty || !draft.enabled || !draft.configured"
          @click="test"
        >
          {{ t("测试向量连接") }}
        </button>
        <small class="faint">{{
          dirty ? t("有未保存的修改") : t("配置已载入")
        }}</small>
      </div>
    </form>
    <p v-if="result" role="status">{{ result }}</p>
  </section>
</template>

<style scoped>
.embedding-profile {
  min-width: 0;
}
.secret {
  -webkit-text-security: disc;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 14px;
  margin: 16px 0;
}
.save-bar {
  position: relative;
  bottom: auto;
}
</style>
