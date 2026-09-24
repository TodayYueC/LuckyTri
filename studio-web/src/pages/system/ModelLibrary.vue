<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { reload, studio } from "../../stores/studio";
import { deleteModel, saveModels, testSavedModel } from "../../plates/models";
import { hueOf } from "../../format";
import Sheet from "../../components/ui/Sheet.vue";
import Empty from "../../components/ui/Empty.vue";

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
const testing = ref(false);
const picker = ref(false);
const testResult = ref("");
const draft = reactive<any>(blank());
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

async function discardDraft() {
  if (!studio.dirty) return true;
  if (
    !(await ask("放弃当前模型草稿？", {
      title: "草稿还没保存",
      confirmText: "放弃",
      cancelText: "留下",
    }))
  )
    return false;
  studio.dirty = false;
  return true;
}

async function select(i: number) {
  const next = modelList.value[i];
  if (!next || next.id === draft.id) return;
  if (!(await discardDraft())) return;
  modelList.value = modelList.value.filter(
    (m: any) =>
      m.id === next.id ||
      studio.core.models.some((saved: any) => saved.id === m.id),
  );
  index.value = modelList.value.findIndex((m: any) => m.id === next.id);
  Object.assign(draft, blank(), next, { apiKey: "" });
  testResult.value = "";
}

async function openPicker() {
  if (!(await discardDraft())) return;
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

async function save() {
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
  if (
    !(await ask("确定删除这个模型？", {
      title: "删除模型",
      confirmText: "删除",
      danger: true,
    }))
  )
    return;
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
  if (!hasSavedProfile.value || studio.dirty || testing.value) return;
  testing.value = true;
  testResult.value = `正在测试「${draft.label || draft.model}」…`;
  try {
    const r = await testSavedModel(draft.id);
    testResult.value = `✓ ${draft.label || r.model} 连接成功 · ${r.latency} ms`;
  } catch (error) {
    testResult.value = (error as Error).message;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="library">
    <aside class="card shelf">
      <div class="shelf-head">
        <h2>
          模型库 <small>{{ modelList.length }}</small>
        </h2>
        <button id="addModel" class="small primary" @click="openPicker">
          ＋ 新增模型
        </button>
      </div>
      <p class="faint">每个会话都可以选择自己的模型。未添加时不会预置连接。</p>
      <div class="rows">
        <p v-if="!modelList.length" class="muted">还没有模型。</p>
        <button
          v-for="(m, i) in modelList"
          :key="m.id"
          class="entity-row"
          :class="{ selected: index === i }"
          @click="select(i)"
        >
          <span
            class="badge"
            :style="{ '--hue': hueOf(m.label || m.model || m.id) }"
            >{{
              String(m.label || m.model || "?")
                .slice(0, 1)
                .toUpperCase()
            }}</span
          >
          <span class="who">
            <b>{{ m.label || m.model }}</b>
            <small
              >{{ m.provider || "自定义供应商"
              }}{{ m.isDefault ? " · 默认" : "" }}</small
            >
          </span>
        </button>
      </div>
    </aside>

    <section v-if="editing" class="card detail">
      <div class="card-head">
        <div>
          <span class="eyebrow">模型档案</span>
          <h2>{{ draft.label || "新模型" }}</h2>
        </div>
        <span class="chip" :data-tone="draft.hasApiKey ? 'ok' : 'warn'">{{
          (draft.isDefault ? "默认模型 · " : "") +
          (draft.hasApiKey ? "密钥已保存" : "待填写密钥")
        }}</span>
      </div>
      <form
        id="modelForm"
        class="stack"
        @submit.prevent="save"
        @input="studio.dirty = true"
      >
        <fieldset>
          <legend>连接</legend>
          <div class="form-grid">
            <label v-if="vendorModels.length > 1">
              同厂商模型
              <select :value="draft.presetId" @change="switchPreset">
                <option
                  v-for="item in vendorModels"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label
              >显示名称<input v-model="draft.label" name="label" required
            /></label>
            <label
              >供应商<input
                v-model="draft.provider"
                name="provider"
                placeholder="例如 deepseek、openai"
            /></label>
            <label
              >API 地址<input
                v-model="draft.baseUrl"
                name="baseUrl"
                type="url"
                required
            /></label>
            <label
              >模型名称<input v-model="draft.model" name="model" required
            /></label>
            <label class="wide">
              API Key
              <input
                v-model="draft.apiKey"
                name="apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="
                  draft.hasApiKey
                    ? '已保存，留空则保留'
                    : '填写供应商提供的密钥'
                "
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>容量与思考</legend>
          <p class="faint">
            官方按输入长度分档计价的模型可以在标准和百万之间切换；输出上限默认是官方最大值，思考强度只列出这个模型支持的档位。
          </p>
          <div class="form-grid">
            <label v-if="contextOptions.length">
              上下文容量
              <select
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
              </select>
            </label>
            <label v-else
              >上下文容量<input
                v-model.number="draft.contextWindow"
                name="contextWindow"
                type="number"
            /></label>
            <label
              >最大输入 Token<input
                v-model.number="draft.maxInputTokens"
                name="maxInputTokens"
                type="number"
            /></label>
            <label
              >最大输出 Token<input
                v-model.number="draft.maxOutputTokens"
                name="maxOutputTokens"
                type="number"
            /></label>
            <label>
              思考强度
              <select v-model="draft.reasoningEffort" name="reasoningEffort">
                <option v-for="v in effortOptions" :key="v" :value="v">
                  {{ effortName(v) }}
                </option>
              </select>
            </label>
          </div>
        </fieldset>
        <details class="advanced">
          <summary>高级参数与模型能力</summary>
          <div class="form-grid">
            <label
              >随机程度 Temperature<input
                v-model.number="draft.temperature"
                name="temperature"
                type="number"
                step="0.05"
            /></label>
            <label
              >采样范围 Top P<input
                v-model.number="draft.topP"
                name="topP"
                type="number"
                step="0.05"
            /></label>
            <label
              >超时（毫秒）<input
                v-model.number="draft.timeoutMs"
                name="timeoutMs"
                type="number"
            /></label>
            <label
              >知识检索模型<input
                v-model="draft.embeddingModel"
                name="embeddingModel"
                placeholder="留空跟随对话模型"
            /></label>
          </div>
          <p class="faint">
            打开图片理解后，聊天里的图片会先在本机读取，再连同画面交给这个模型。主模型不能看图时，到会话设置另选一个打开了图片理解的视觉兼容模型。
          </p>
          <div class="caps">
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
            >
              <input v-model="draft[key]" :name="key" type="checkbox" />{{
                label
              }}
            </label>
          </div>
        </details>
        <div
          v-if="testResult"
          id="modelTestResult"
          class="notice"
          role="status"
        >
          {{ testResult }}
        </div>
        <div class="actions">
          <button class="primary" :disabled="busy">
            {{ busy ? "正在保存…" : "保存模型" }}
          </button>
          <button
            v-if="!draft.isDefault"
            id="setDefaultModel"
            type="button"
            @click="makeDefault"
          >
            设为默认模型
          </button>
          <button
            v-if="hasSavedProfile"
            id="testModel"
            type="button"
            :disabled="busy || testing || studio.dirty"
            @click="testModel"
          >
            {{
              testing
                ? "正在测试…"
                : studio.dirty
                  ? "保存后测试此模型"
                  : "测试此模型连接"
            }}
          </button>
          <button
            id="deleteModel"
            type="button"
            class="danger push"
            @click="remove"
          >
            删除模型
          </button>
        </div>
      </form>
    </section>
    <section v-else class="card detail">
      <Empty
        title="还没有模型"
        text="常见厂商会预填模型参数；OpenRouter 可选 GPT-6 预设，也可用自选模型手动填写模型 ID 和参数。"
      >
        <button class="primary" @click="openPicker">＋ 新增模型</button>
      </Empty>
    </section>

    <Sheet
      :open="picker"
      title="选择模型"
      eyebrow="MODELS"
      width="880px"
      @close="picker = false"
    >
      <div class="model-picker">
        <p class="muted">
          常见厂商预设会填入对应参数。OpenRouter 提供 GPT-6
          预设和自选模型；自选模型只预填 API 地址，其余按模型信息填写。
        </p>
        <section v-for="group in groups" :key="group.vendor" class="vendor">
          <h3>{{ group.vendor }}</h3>
          <div class="presets">
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
        </section>
        <button
          v-if="customPreset"
          type="button"
          class="preset-card custom"
          data-preset="custom"
          @click="choosePreset(customPreset)"
        >
          <b>{{ customPreset.label }}</b>
          <small>{{ customPreset.summary }}</small>
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}
.shelf {
  display: grid;
  gap: 10px;
}
.shelf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.shelf-head h2 {
  font-size: 16px;
}
.shelf-head small {
  color: var(--ink-soft);
  font-size: 12px;
}
.rows {
  display: grid;
  gap: 4px;
  max-height: 520px;
  overflow: auto;
}
.entity-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 14px;
  background: transparent;
  text-align: left;
}
.entity-row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  transform: none;
  box-shadow: none;
}
.entity-row.selected {
  background: var(--accent-soft);
}
.badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: hsl(var(--hue) 70% 88%);
  color: hsl(var(--hue) 45% 25%);
  font-weight: 700;
}
.who {
  display: grid;
  min-width: 0;
  line-height: 1.35;
}
.who b {
  overflow: hidden;
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who small {
  color: var(--ink-soft);
  font-size: 11.5px;
  font-weight: 500;
}
fieldset {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
}
legend {
  padding: 0 8px;
  font-weight: 700;
  font-size: 13px;
}
.advanced summary {
  color: var(--accent);
  font-weight: 600;
}
.advanced[open] summary {
  margin-bottom: 12px;
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 10px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions .push {
  margin-left: auto;
}
.model-picker {
  display: grid;
  gap: 16px;
}
.vendor h3 {
  margin-bottom: 8px;
  font-size: 14px;
}
.presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
.preset-card {
  display: grid;
  justify-items: start;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 16px;
  text-align: left;
  font-weight: 500;
}
.preset-card small {
  color: var(--ink-soft);
  font-size: 11.5px;
}
@media (max-width: 900px) {
  .library {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
