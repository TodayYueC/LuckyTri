<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { studio, reload } from "../store";
import { toast } from "../api";
import { deleteModel, saveModels, testSavedModel } from "../plates/models";

const catalog = computed(() => studio.health?.modelCatalog || []);
const effortLabels = computed(
  () =>
    (studio.health?.effortLabels || {
      none: "关闭",
      minimal: "极低",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
      max: "最深",
    }) as Record<string, string>,
);
const modelList = ref(studio.core.models.map((m: any) => ({ ...m })));
const index = ref(modelList.value.length ? 0 : -1);
const busy = ref(false);
const picker = ref(false);
const testResult = ref("");
const draft = reactive(blank());
if (modelList.value[0])
  Object.assign(draft, modelList.value[0], { apiKey: "" });

const editing = computed(() => index.value >= 0 && !!draft.id);
const groups = computed(() => {
  const rows: { vendor: string; models: any[] }[] = [];
  for (const item of catalog.value) {
    if (item.id === "custom") continue;
    let group = rows.find((row) => row.vendor === item.vendor);
    if (!group) {
      group = { vendor: item.vendor, models: [] };
      rows.push(group);
    }
    group.models.push(item);
  }
  return rows;
});
const customPreset = computed(() =>
  catalog.value.find((item: any) => item.id === "custom"),
);
const vendorModels = computed(() =>
  catalog.value.filter(
    (item: any) => item.vendor && item.vendor === draft.vendor,
  ),
);
const effortOptions = computed(() => {
  const list =
    Array.isArray(draft.reasoningEfforts) && draft.reasoningEfforts.length
      ? [...draft.reasoningEfforts]
      : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (draft.reasoningEffort && !list.includes(draft.reasoningEffort))
    list.unshift(draft.reasoningEffort);
  return list;
});
const canTest = computed(
  () =>
    !!draft.isDefault && studio.core.models.some((m: any) => m.id === draft.id),
);

function blank() {
  return {
    id: "",
    presetId: "",
    label: "",
    provider: "",
    vendor: "",
    baseUrl: "",
    model: "",
    apiKey: "",
    hasApiKey: false,
    contextWindow: 128000,
    maxInputTokens: 119808,
    maxOutputTokens: 8192,
    vision: false,
    system: true,
    json: true,
    tools: false,
    embedding: false,
    embeddingModel: "",
    reasoningEffort: "none",
    reasoningEfforts: ["none", "low", "medium", "high"],
    thinkingStyle: "openai",
    tokenField: "max_tokens",
    temperature: 0.85,
    topP: 1,
    timeoutMs: 90000,
    isDefault: false,
  };
}

function fitBudget(profile: any) {
  let context = Number(profile.contextWindow);
  let output = Number(profile.maxOutputTokens);
  let input = Number(profile.maxInputTokens);
  if (!Number.isFinite(context) || context < 2) context = 2;
  if (!Number.isFinite(output) || output < 1) output = 1;
  if (output >= context) output = context - 1;
  if (!Number.isFinite(input) || input < 1) input = context - output;
  if (input + output > context) input = context - output;
  return {
    contextWindow: context,
    maxInputTokens: input,
    maxOutputTokens: output,
  };
}

function formatTokens(value: number) {
  if (value >= 1000000) {
    const scaled = value / 1000000;
    const text = Number.isInteger(scaled)
      ? String(scaled)
      : scaled.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return text + "M";
  }
  if (value >= 1000) return Math.round(value / 1000) + "K";
  return String(value || 0);
}

function select(i: number) {
  const next = modelList.value[i];
  if (!next || next.id === draft.id) return;
  if (studio.dirty && !confirm("放弃当前模型草稿？")) return;
  modelList.value = modelList.value.filter(
    (m: any) =>
      m.id === next.id ||
      studio.core.models.some((saved: any) => saved.id === m.id),
  );
  index.value = modelList.value.findIndex((m: any) => m.id === next.id);
  Object.assign(draft, blank(), next, { apiKey: "" });
  testResult.value = "";
  studio.dirty = false;
}

function openPicker() {
  if (studio.dirty && !confirm("放弃当前模型草稿？")) return;
  studio.dirty = false;
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  if (!modelList.value.length) {
    index.value = -1;
    Object.assign(draft, blank());
  } else if (!modelList.value.some((m: any) => m.id === draft.id)) {
    index.value = 0;
    Object.assign(draft, blank(), modelList.value[0], { apiKey: "" });
  }
  picker.value = true;
}

function choosePreset(preset: any) {
  const { summary: _summary, ...fields } = preset;
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  const row = {
    ...blank(),
    ...fields,
    presetId: preset.id,
    id: "model-" + Date.now(),
    apiKey: "",
    hasApiKey: false,
    isDefault: modelList.value.length === 0,
  };
  modelList.value.push(row);
  index.value = modelList.value.length - 1;
  Object.assign(draft, row);
  testResult.value = "";
  picker.value = false;
  studio.dirty = true;
}

function switchPreset(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const preset = catalog.value.find((item: any) => item.id === id);
  if (!preset) return;
  const { summary: _summary, ...fields } = preset;
  Object.assign(draft, fields, {
    presetId: preset.id,
    id: draft.id,
    apiKey: draft.apiKey,
    hasApiKey: draft.hasApiKey,
    isDefault: draft.isDefault,
  });
  const current = modelList.value[index.value];
  if (current) current.label = draft.label;
  studio.dirty = true;
}

function makeDefault() {
  for (const model of modelList.value) model.isDefault = model.id === draft.id;
  draft.isDefault = true;
  studio.dirty = true;
}

async function save(e: Event) {
  e.preventDefault();
  const fitted = fitBudget(draft);
  const models = modelList.value.map((m: any, i: number) =>
    i === index.value
      ? {
          ...draft,
          ...fitted,
          isDefault: !!draft.isDefault,
          timeoutMs: Number(draft.timeoutMs),
          temperature: Number(draft.temperature),
          topP: Number(draft.topP),
        }
      : { ...m, isDefault: !!m.isDefault && m.id !== draft.id },
  );
  if (!models.some((m: any) => m.isDefault) && models.length)
    models[0].isDefault = true;
  if (busy.value) return;
  busy.value = true;
  try {
    await saveModels(models);
    studio.dirty = false;
    await reload();
    modelList.value = studio.core.models.map((m: any) => ({ ...m }));
    Object.assign(draft, blank(), modelList.value[index.value], { apiKey: "" });
    toast("已保存并应用");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirm("确定删除这个模型？")) return;
  if (studio.core.models.some((m: any) => m.id === draft.id))
    await deleteModel(draft.id);
  studio.dirty = false;
  await reload();
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  testResult.value = "";
  if (!modelList.value.length) {
    index.value = -1;
    Object.assign(draft, blank());
    return;
  }
  index.value = 0;
  Object.assign(draft, blank(), modelList.value[0], { apiKey: "" });
}

async function testModel() {
  testResult.value = "正在测试已保存的默认模型…";
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
      <p class="small">每个会话都可以选择自己的模型。未添加时不会预置连接。</p>
      <div class="list-scroll">
        <p v-if="!modelList.length" class="empty-copy">还没有模型。</p>
        <button
          v-for="(m, i) in modelList"
          :key="m.id"
          class="entity-row"
          :class="{ selected: index === i }"
          @click="select(i)"
        >
          <span class="entity-symbol">{{
            String(m.label || m.model || "?")
              .slice(0, 1)
              .toUpperCase()
          }}</span
          ><span
            ><b>{{ m.label || m.model }}</b
            ><small
              >{{ m.provider || "自定义供应商" }}
              {{ m.isDefault ? "· 默认" : "" }}</small
            ></span
          ><span>↗</span>
        </button>
      </div>
      <button id="addModel" class="primary" @click="openPicker">
        ＋ 新增模型
      </button>
    </aside>
    <section v-if="editing" class="detail-pane surface">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">MODEL PROFILE</span>
          <h2>{{ draft.label || "新模型" }}</h2>
        </div>
        <span class="status-tag">{{
          (draft.isDefault ? "默认模型 · " : "") +
          (draft.hasApiKey ? "密钥已保存" : "待填写密钥")
        }}</span>
      </div>
      <form id="modelForm" @submit="save" @input="studio.dirty = true">
        <div class="form-scroll">
          <fieldset>
            <legend>01 / 连接</legend>
            <div class="grid">
              <label v-if="vendorModels.length > 1"
                >同厂商模型<select
                  :value="draft.presetId"
                  @change="switchPreset"
                >
                  <option
                    v-for="item in vendorModels"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.label }}
                  </option>
                </select></label
              ><label
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
              上下文和输出上限已按该模型当前官方参数填好，仍可按聊天需要改小。思考强度只列出这个模型支持的档位。
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
                  <option v-for="v in effortOptions" :value="v" :key="v">
                    {{ effortLabels[v] || v }} / {{ v }}
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
            v-if="!draft.isDefault"
            type="button"
            id="setDefaultModel"
            @click="makeDefault"
          >
            设为默认模型</button
          ><button
            v-if="canTest"
            type="button"
            id="testModel"
            @click="testModel"
          >
            测试默认模型连接</button
          ><button
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
    <section v-else class="detail-pane surface">
      <div class="empty-state">
        <span>✦</span>
        <h3>还没有模型</h3>
        <p>
          选择厂商后会填好接口地址、模型名、上下文和思考强度，只需再填写 API
          Key。
        </p>
        <button class="primary" @click="openPicker">＋ 新增模型</button>
      </div>
    </section>
  </div>
  <div v-if="picker" class="modal-backdrop" @click.self="picker = false">
    <section
      class="modal model-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="addModelTitle"
    >
      <div class="section-heading">
        <h2 id="addModelTitle">选择模型</h2>
        <button type="button" aria-label="关闭" @click="picker = false">
          ×
        </button>
      </div>
      <p class="small">
        参数来自各厂商当前文档，包含上下文、输出上限和思考档位。保存前仍可修改。
      </p>
      <div v-for="group in groups" :key="group.vendor" class="vendor-block">
        <h3>{{ group.vendor }}</h3>
        <div class="preset-grid">
          <button
            v-for="item in group.models"
            :key="item.id"
            type="button"
            class="preset-card"
            :data-preset="item.id"
            @click="choosePreset(item)"
          >
            <b>{{ item.label }}</b>
            <small>{{ item.model }}</small>
            <small
              >上下文 {{ formatTokens(item.contextWindow) }} · 输出
              {{ formatTokens(item.maxOutputTokens) }}</small
            >
            <small>{{ item.summary }}</small>
          </button>
        </div>
      </div>
      <button
        v-if="customPreset"
        type="button"
        class="preset-card custom-preset"
        data-preset="custom"
        @click="choosePreset(customPreset)"
      >
        <b>{{ customPreset.label }}</b>
        <small>{{ customPreset.summary }}</small>
      </button>
    </section>
  </div>
</template>
