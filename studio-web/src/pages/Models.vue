<script setup lang="ts">
import { reactive, ref } from "vue";
import { studio, reload } from "../store";
import { toast } from "../api";
import { deleteModel, saveModels, testSavedModel } from "../plates/models";
import { patchSettings } from "../plates/workspace";

const index = ref(0);
const draft = reactive({ ...studio.core.models[0] });
const testResult = ref("");

function select(i: number) {
  if (studio.dirty && !confirm("放弃当前模型草稿？")) return;
  index.value = i;
  Object.assign(draft, studio.core.models[i], { apiKey: "" });
  studio.dirty = false;
}

function addModel() {
  studio.core.models.push({
    ...studio.core.models[0],
    id: "model-" + Date.now(),
    label: "新模型",
    hasApiKey: false,
    apiKey: "",
    embedding: false,
    embeddingModel: "",
  });
  select(studio.core.models.length - 1);
}

async function save(e: Event) {
  e.preventDefault();
  const models = studio.core.models.map((m: any, i: number) =>
    i === index.value
      ? {
          ...draft,
          contextWindow: Number(draft.contextWindow),
          maxInputTokens: Number(draft.maxInputTokens),
          maxOutputTokens: Number(draft.maxOutputTokens),
          timeoutMs: Number(draft.timeoutMs),
          temperature: Number(draft.temperature),
          topP: Number(draft.topP),
        }
      : m,
  );
  await saveModels(models);
  studio.dirty = false;
  await reload();
  Object.assign(draft, studio.core.models[index.value], { apiKey: "" });
  toast("已保存并应用");
}

async function remove() {
  if (!confirm("确定删除这个模型？")) return;
  await deleteModel(draft.id);
  index.value = 0;
  await reload();
  select(0);
}

async function saveCompat(e: Event) {
  e.preventDefault();
  const v: any = Object.fromEntries(new FormData(e.target as HTMLFormElement));
  if (!v.apiKey) delete v.apiKey;
  await patchSettings({
    model: v.model,
    baseUrl: v.baseUrl,
    apiKey: v.apiKey,
  });
  await reload();
  studio.dirty = false;
  toast("连接设置已保存");
}

async function testModel() {
  testResult.value = "正在测试已保存的配置…";
  try {
    const r = await testSavedModel();
    testResult.value = `✓ 连接成功 · ${r.model} · ${r.latency} ms`;
  } catch (e) {
    testResult.value = (e as Error).message;
  }
}
</script>

<template>
  <section class="panel">
    <h2>模型档案</h2>
    <div class="row">
      <select
        id="modelSelect"
        :value="index"
        @change="select(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="(m, i) in studio.core.models" :key="m.id" :value="i">
          {{ m.label || m.model }}
        </option>
      </select>
      <button id="addModel" type="button" @click="addModel">新增模型</button>
    </div>
    <form id="modelForm" @submit="save" @input="studio.dirty = true">
      <h3 class="section-title">01 / 连接信息</h3>
      <p class="small">先填写供应商提供的地址、模型名称与密钥。</p>
      <div class="grid">
        <label>档案 ID<input name="id" v-model="draft.id" /></label>
        <label>显示名称<input name="label" v-model="draft.label" /></label>
        <label>供应商<input name="provider" v-model="draft.provider" /></label>
        <label>API 地址<input name="baseUrl" v-model="draft.baseUrl" /></label>
        <label>模型名称<input name="model" v-model="draft.model" /></label>
        <label
          >API Key<input
            name="apiKey"
            type="password"
            v-model="draft.apiKey"
            :placeholder="draft.hasApiKey ? '已保存，留空保留' : ''"
        /></label>
      </div>
      <h3 class="section-title">02 / 容量与生成</h3>
      <p class="small">
        按模型实际支持的范围填写。Token 是模型计算文本长度的单位。
      </p>
      <div class="grid">
        <label
          >上下文容量（Token）<input
            name="contextWindow"
            type="number"
            v-model.number="draft.contextWindow"
        /></label>
        <label
          >最大输入（Token）<input
            name="maxInputTokens"
            type="number"
            v-model.number="draft.maxInputTokens"
        /></label>
        <label
          >最大输出（Token）<input
            name="maxOutputTokens"
            type="number"
            v-model.number="draft.maxOutputTokens"
        /></label>
        <label
          >请求超时（毫秒）<input
            name="timeoutMs"
            type="number"
            v-model.number="draft.timeoutMs"
        /></label>
        <label
          >随机程度（Temperature）<input
            name="temperature"
            type="number"
            step="0.05"
            v-model.number="draft.temperature"
        /></label>
        <label
          >采样范围（Top P）<input
            name="topP"
            type="number"
            step="0.05"
            v-model.number="draft.topP"
        /></label>
        <label
          >思考强度<input
            name="reasoningEffort"
            v-model="draft.reasoningEffort"
        /></label>
        <label
          >知识检索模型<input
            name="embeddingModel"
            v-model="draft.embeddingModel"
            placeholder="留空则用对话模型名"
        /></label>
      </div>
      <h3 class="section-title">03 / 模型能力</h3>
      <div class="row">
        <label class="check"
          ><input
            name="vision"
            type="checkbox"
            v-model="draft.vision"
          />视觉</label
        >
        <label class="check"
          ><input name="system" type="checkbox" v-model="draft.system" />System
          Prompt</label
        >
        <label class="check"
          ><input name="json" type="checkbox" v-model="draft.json" />JSON
          输出</label
        >
        <label class="check"
          ><input
            name="tools"
            type="checkbox"
            v-model="draft.tools"
          />工具能力标记</label
        >
        <label class="check"
          ><input
            name="embedding"
            type="checkbox"
            v-model="draft.embedding"
          />Embedding / 知识向量</label
        >
      </div>
      <p class="small">
        知识检索能力用于查找相关文档；请仅开启供应商确认支持的能力。
      </p>
      <div class="row">
        <button class="primary" type="submit">保存并应用</button>
        <button
          v-if="draft.id !== 'default'"
          type="button"
          id="deleteModel"
          @click="remove"
        >
          删除这个模型
        </button>
        <button type="button" id="testModel" @click="testModel">
          测试模型连接
        </button>
      </div>
      <div id="modelTestResult">{{ testResult }}</div>
    </form>
  </section>
  <section class="panel" id="settings">
    <h2>默认连接快捷设置</h2>
    <p class="small">
      用于旧版默认连接配置。需要独立模型与高级参数时，请使用上方模型档案。
    </p>
    <form @submit="saveCompat" @input="studio.dirty = true">
      <label
        >模型名称<input name="model" :value="studio.health.settings.model"
      /></label>
      <label
        >API 地址<input name="baseUrl" :value="studio.health.settings.baseUrl"
      /></label>
      <label>API Key<input name="apiKey" type="password" /></label>
      <button class="primary">保存连接设置</button>
    </form>
  </section>
</template>
