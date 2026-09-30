<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, toast } from "../../api";

const draft = reactive<any>({
  enabled: false,
  label: "知识向量",
  baseUrl: "",
  model: "",
  apiKey: "",
  dimensions: 0,
  batchSize: 32,
  timeoutMs: 90000,
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
    toast("知识向量模型已保存");
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
    result.value = `连接成功，向量维度 ${data.dimensions}`;
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
    <h2 id="embedding-title">知识向量模型</h2>
    <p class="muted">
      单独配置资料检索使用的模型。更换对话模型后仍使用这里的配置。更换向量模型后，可在资料书架逐份重建向量；原文仍能通过关键词检索。
    </p>
    <p v-if="loaded && !draft.configured" class="faint">
      当前兼容旧配置，跟随默认模型。保存后改用独立配置。
    </p>
    <form
      v-if="loaded"
      @submit.prevent="save"
      @input="dirty = true"
      @change="dirty = true"
    >
      <label class="check"
        ><input
          v-model="draft.enabled"
          type="checkbox"
          name="embeddingEnabled"
        />启用知识向量</label
      >
      <div class="fields">
        <label
          >API 地址<input
            v-model="draft.baseUrl"
            name="embeddingBaseUrl"
            type="url"
            :required="draft.enabled"
            placeholder="https://example.com/v1"
        /></label>
        <label
          >模型名称<input
            v-model="draft.model"
            name="embeddingModelName"
            :required="draft.enabled"
        /></label>
        <label
          >独立 API Key<input
            v-model="draft.apiKey"
            name="embeddingApiKey"
            type="password"
            autocomplete="new-password"
            :placeholder="
              draft.hasApiKey ? '已保存，留空保留' : '填写向量服务密钥'
            "
        /></label>
        <label
          >向量维度（0 表示自动）<input
            v-model.number="draft.dimensions"
            name="embeddingDimensions"
            type="number"
            min="0"
            max="65536"
        /></label>
        <label
          >每批段落数<input
            v-model.number="draft.batchSize"
            name="embeddingBatchSize"
            type="number"
            min="1"
            max="128"
        /></label>
      </div>
      <div class="save-bar">
        <button class="primary" :disabled="busy">保存向量模型</button>
        <button
          type="button"
          :disabled="busy || dirty || !draft.enabled || !draft.configured"
          @click="test"
        >
          测试向量连接
        </button>
        <small class="faint">{{
          dirty ? "有未保存的修改" : "配置已载入"
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
