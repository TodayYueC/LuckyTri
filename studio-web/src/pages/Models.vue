<script setup lang="ts">
import { reactive, ref } from "vue";
import { studio, reload } from "../store";
import { toast } from "../api";
import { deleteModel, saveModels, testSavedModel } from "../plates/models";

const index = ref(0);
const busy = ref(false);
const modelList = ref(studio.core.models.map((m: any) => ({ ...m })));
const draft = reactive({ ...modelList.value[0] });
const testResult = ref("");

function select(i: number) {
  const next = modelList.value[i];
  if (next?.id === draft.id) return;
  if (studio.dirty && !confirm("放弃当前模型草稿？")) return;
  modelList.value = modelList.value.filter(
    (m: any) =>
      m.id === next.id ||
      studio.core.models.some((saved: any) => saved.id === m.id),
  );
  index.value = modelList.value.findIndex((m: any) => m.id === next.id);
  Object.assign(draft, next, { apiKey: "" });
  testResult.value = "";
  studio.dirty = false;
}

function addModel() {
  if (studio.dirty && !confirm("放弃当前模型草稿？")) return;
  studio.dirty = false;
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  modelList.value.push({
    ...modelList.value[0],
    id: "model-" + Date.now(),
    label: "新模型",
    hasApiKey: false,
    apiKey: "",
    embedding: false,
    embeddingModel: "",
  });
  select(modelList.value.length - 1);
  studio.dirty = true;
}

async function save(e: Event) {
  e.preventDefault();
  const models = modelList.value.map((m: any, i: number) =>
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
  if (busy.value) return;
  busy.value = true;
  try {
    await saveModels(models);
    studio.dirty = false;
    await reload();
    modelList.value = studio.core.models.map((m: any) => ({ ...m }));
    Object.assign(draft, modelList.value[index.value], { apiKey: "" });
    toast("已保存并应用");
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirm("确定删除这个模型？")) return;
  if (studio.core.models.some((m: any) => m.id === draft.id))
    await deleteModel(draft.id);
  studio.dirty = false;
  index.value = 0;
  await reload();
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  select(0);
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
  <div class="master-detail model-workbench">
    <aside class="master-list surface">
      <div class="section-heading">
        <h2>模型库</h2>
        <span class="status-tag">{{ modelList.length }}</span>
      </div>
      <p class="small">每个会话都可以选择自己的模型。</p>
      <div class="list-scroll">
        <button
          v-for="(m, i) in modelList"
          :key="m.id"
          class="entity-row"
          :class="{ selected: index === i }"
          @click="select(i)"
        >
          <span class="entity-symbol">{{
            String(m.label || m.model)
              .slice(0, 1)
              .toUpperCase()
          }}</span
          ><span
            ><b>{{ m.label || m.model }}</b
            ><small
              >{{ m.provider || "自定义供应商" }}
              {{ m.id === "default" ? "· 默认" : "" }}</small
            ></span
          ><span>↗</span>
        </button>
      </div>
      <button id="addModel" class="primary" @click="addModel">
        ＋ 新增模型
      </button>
    </aside>
    <section class="detail-pane surface">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">MODEL PROFILE</span>
          <h2>{{ draft.label || "新模型" }}</h2>
        </div>
        <span class="status-tag">{{
          draft.hasApiKey ? "密钥已保存" : "待填写密钥"
        }}</span>
      </div>
      <form id="modelForm" @submit="save" @input="studio.dirty = true">
        <div class="form-scroll">
          <fieldset>
            <legend>01 / 连接</legend>
            <div class="grid">
              <label
                >显示名称<input
                  name="label"
                  v-model="draft.label"
                  required /></label
              ><label
                >供应商<input
                  name="provider"
                  v-model="draft.provider"
                  placeholder="例如 deepseek、openai" /></label
              ><label
                >API 地址<input
                  name="baseUrl"
                  v-model="draft.baseUrl"
                  type="url"
                  required /></label
              ><label
                >模型名称<input
                  name="model"
                  v-model="draft.model"
                  required /></label
              ><label class="span-two"
                >API Key<input
                  name="apiKey"
                  type="password"
                  v-model="draft.apiKey"
                  autocomplete="new-password"
                  :placeholder="
                    draft.hasApiKey
                      ? '已保存，留空则保留'
                      : '填写供应商提供的密钥'
                  "
              /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>02 / 容量与思考</legend>
            <p class="small">
              Token 是模型计算文本长度的单位，请按供应商支持的容量填写。
            </p>
            <div class="grid">
              <label
                >上下文容量<input
                  name="contextWindow"
                  type="number"
                  v-model.number="draft.contextWindow" /></label
              ><label
                >最大输入 Token<input
                  name="maxInputTokens"
                  type="number"
                  v-model.number="draft.maxInputTokens" /></label
              ><label
                >最大输出 Token<input
                  name="maxOutputTokens"
                  type="number"
                  v-model.number="draft.maxOutputTokens" /></label
              ><label
                >思考强度<select
                  name="reasoningEffort"
                  v-model="draft.reasoningEffort"
                >
                  <option
                    v-for="v in [
                      'none',
                      'minimal',
                      'low',
                      'medium',
                      'high',
                      'xhigh',
                    ]"
                    :value="v"
                    :key="v"
                  >
                    {{
                      (
                        {
                          none: "关闭",
                          minimal: "极低",
                          low: "低",
                          medium: "中",
                          high: "高",
                          xhigh: "极高",
                        } as any
                      )[v]
                    }}
                    / {{ v }}
                  </option>
                </select></label
              >
            </div>
          </fieldset>
          <details class="advanced-settings">
            <summary>高级参数与模型能力</summary>
            <div class="grid">
              <label
                >随机程度 Temperature<input
                  name="temperature"
                  type="number"
                  step="0.05"
                  v-model.number="draft.temperature" /></label
              ><label
                >采样范围 Top P<input
                  name="topP"
                  type="number"
                  step="0.05"
                  v-model.number="draft.topP" /></label
              ><label
                >超时（毫秒）<input
                  name="timeoutMs"
                  type="number"
                  v-model.number="draft.timeoutMs" /></label
              ><label
                >知识检索模型<input
                  name="embeddingModel"
                  v-model="draft.embeddingModel"
                  placeholder="留空跟随对话模型"
              /></label>
            </div>
            <div class="capability-grid">
              <label
                v-for="(label, key) in {
                  vision: '图片理解',
                  system: 'System Prompt',
                  json: 'JSON 输出',
                  tools: '工具调用',
                  embedding: '知识向量',
                }"
                :key="key"
                class="check"
                ><input :name="key" type="checkbox" v-model="draft[key]" />{{
                  label
                }}</label
              >
            </div>
          </details>
          <div
            id="modelTestResult"
            v-if="testResult"
            class="notice"
            role="status"
          >
            {{ testResult }}
          </div>
        </div>
        <div class="action-bar">
          <button class="primary" :disabled="busy">
            {{ busy ? "正在保存…" : "保存模型 ↗" }}</button
          ><button
            v-if="draft.id === 'default'"
            type="button"
            id="testModel"
            @click="testModel"
          >
            测试默认模型连接</button
          ><button
            v-if="draft.id !== 'default'"
            type="button"
            id="deleteModel"
            class="danger push-end"
            @click="remove"
          >
            删除模型
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
