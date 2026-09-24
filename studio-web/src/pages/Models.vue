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
const testingModel = ref(false);
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
const draftPreset = computed(
  () =>
    catalog.value.find((item: any) => item.id === draft.presetId) ||
    catalog.value.find(
      (item: any) =>
        item.model &&
        item.model === draft.model &&
        item.baseUrl === draft.baseUrl,
    ),
);
const contextOptions = computed(() => {
  const windows = draftPreset.value?.contextWindows || [];
  if (windows.length < 2) return [];
  const current = Number(draft.contextWindow);
  if (windows.some((item: any) => item.contextWindow === current))
    return windows;
  return [
    ...windows,
    {
      label: "已保存 " + formatTokens(current),
      contextWindow: current,
      maxInputTokens: Number(draft.maxInputTokens),
      maxOutputTokens: Number(draft.maxOutputTokens),
    },
  ];
});
const effortOptions = computed(() => {
  const list =
    Array.isArray(draft.reasoningEfforts) && draft.reasoningEfforts.length
      ? [...draft.reasoningEfforts]
      : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (draft.reasoningEffort && !list.includes(draft.reasoningEffort))
    list.unshift(draft.reasoningEffort);
  return list;
});
const hasSavedProfile = computed(() =>
  studio.core.models.some((m: any) => m.id === draft.id),
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
    omitSampling: false,
    temperature: 0.85,
    topP: 1,
    timeoutMs: 90000,
    isDefault: false,
  };
}

function presetFields(preset: any) {
  const { summary: _summary, contextWindows: _windows, ...fields } = preset;
  return { ...fields, presetId: preset.id };
}

function withoutWindows(model: any) {
  const { contextWindows: _windows, ...rest } = model;
  return rest;
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

function applyContextWindow(event: Event) {
  const selected = Number((event.target as HTMLSelectElement).value);
  const option = contextOptions.value.find(
    (item: any) => item.contextWindow === selected,
  );
  if (!option) return;
  draft.contextWindow = option.contextWindow;
  draft.maxInputTokens = option.maxInputTokens;
  draft.maxOutputTokens = option.maxOutputTokens;
  studio.dirty = true;
}

// Vendors publish both decimal (128,000) and binary (131,072) ceilings and
// call both "128K", so show whichever reading gives a whole number.
function formatTokens(value: number) {
  const n = Number(value) || 0;
  if (n >= 1000000)
    return (
      (n % 1048576 === 0 ? n / 1048576 : Number((n / 1000000).toFixed(2))) + "M"
    );
  if (n >= 1000)
    return (
      (n % 1000 === 0
        ? n / 1000
        : n % 1024 === 0
          ? n / 1024
          : Math.round(n / 1000)) + "K"
    );
  return String(n);
}

function capacity(item: any) {
  if (item.id === "openrouter") return "按所选模型填写上下文和输出参数";
  if (!item.model) return "填写模型 ID 和对应参数";
  const windows = item.contextWindows || [];
  const context = windows.length
    ? windows.map((w: any) => w.label).join(" / ")
    : formatTokens(item.contextWindow);
  return `上下文 ${context} · 输出 ${formatTokens(item.maxOutputTokens)}`;
}

function effortName(value: string) {
  if (["mimo", "qwen", "kimi-toggle"].includes(draft.thinkingStyle))
    return value === "none" ? "关闭" : "开启";
  return `${effortLabels.value[value] || value} / ${value}`;
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
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  const row = {
    ...blank(),
    ...presetFields(preset),
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
  Object.assign(draft, blank(), presetFields(preset), {
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
    withoutWindows(
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
    ),
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
  if (!hasSavedProfile.value || studio.dirty || testingModel.value) return;
  testingModel.value = true;
  testResult.value = `正在测试「${draft.label || draft.model}」…`;
  try {
    const r = await testSavedModel(draft.id);
    testResult.value = `✓ ${draft.label || r.model} 连接成功 · ${r.latency} ms`;
  } catch (e) {
    testResult.value = (e as Error).message;
  } finally {
    testingModel.value = false;
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
              官方按输入长度分档计价的模型可以在标准和百万之间切换；官方只有一个窗口的模型直接按官方上限填写。输出上限默认是官方最大值，思考强度只列出这个模型支持的档位。
            </p>
            <div class="grid">
              <label v-if="contextOptions.length"
                >上下文容量<select
                  name="contextWindow"
                  :value="draft.contextWindow"
                  @change="applyContextWindow"
                >
                  <option
                    v-for="option in contextOptions"
                    :key="option.contextWindow"
                    :value="option.contextWindow"
                  >
                    {{ option.label }}
                  </option>
                </select></label
              ><label v-else
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
                    {{ effortName(v) }}
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
            <p class="small">
              打开图片理解后，聊天里的图片会先在本机读取，再连同画面交给这个模型。主模型不能看图时，到会话设置另选一个打开了图片理解的视觉兼容模型。
            </p>
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
            v-if="hasSavedProfile"
            type="button"
            id="testModel"
            :disabled="busy || testingModel || studio.dirty"
            @click="testModel"
          >
            {{
              testingModel
                ? "正在测试…"
                : studio.dirty
                  ? "保存后测试此模型"
                  : "测试此模型连接"
            }}</button
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
          常见厂商会预填模型参数；OpenRouter 可选 GPT-6
          预设，也可用自选模型手动填写模型 ID 和参数。
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
        常见厂商预设会填入对应参数。OpenRouter 提供 GPT-6
        预设和自选模型；自选模型只预填 API 地址，其余按模型信息填写。
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
            <small>{{
              item.model || "填写你在 OpenRouter 选择的模型 ID"
            }}</small>
            <small>{{ capacity(item) }}</small>
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
