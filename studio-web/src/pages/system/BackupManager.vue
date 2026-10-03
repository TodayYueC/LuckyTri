<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, toast } from "../../api";
import { ask } from "../../dialog";
import { intlLocale, t } from "../../i18n";
import { studio } from "../../stores/studio";

type Entry = {
  scope: string;
  name: string;
  kind: "auto" | "full" | "migration" | "legacy" | "snapshot";
  bytes: number;
  modified: number;
  at: number;
  manifest: boolean;
  protected: boolean;
};
type Policy = {
  enabled: boolean;
  time: string;
  retainDays: number;
  keepFull: number;
};
type Info = {
  entries: Entry[];
  policy: Policy;
  plan: { items: Entry[]; bytes: number };
  totalBytes: number;
  serverTimeZone: string;
  last: { at: number; removed: number; bytes: number; error?: string } | null;
  running: boolean;
};

const info = ref<Info | null>(null);
const form = ref<Policy>({
  enabled: true,
  time: "04:30",
  retainDays: 14,
  keepFull: 2,
});
const selected = ref<string[]>([]);
const busy = ref(false);
const error = ref("");
let active = true;
const key = (item: Entry) => `${item.scope}:${item.name}`;
const chosen = computed(
  () =>
    info.value?.entries.filter((item) => selected.value.includes(key(item))) ||
    [],
);
const chosenBytes = computed(() =>
  chosen.value.reduce((sum, item) => sum + item.bytes, 0),
);
const size = (bytes: number) =>
  bytes === 0
    ? "0 B"
    : bytes >= 1073741824
      ? `${(bytes / 1073741824).toFixed(2)} GiB`
      : `${Math.max(0.01, bytes / 1048576).toFixed(2)} MiB`;
const date = (time: number) => new Date(time).toLocaleString(intlLocale());
const label = (kind: Entry["kind"]) =>
  ({
    auto: t("自动备份"),
    full: t("完整备份"),
    migration: t("迁移快照"),
    legacy: t("旧版本备份"),
    snapshot: t("升级前快照"),
  })[kind];

async function load(reset = false) {
  try {
    error.value = "";
    const next = await api("/storage/cleanup");
    if (!active) return;
    info.value = next;
    if (reset) {
      form.value = { ...info.value!.policy };
      selected.value = [];
      studio.dirty = false;
    } else {
      const available = new Set(
        info.value!.entries.filter((item) => !item.protected).map(key),
      );
      selected.value = selected.value.filter((id) => available.has(id));
    }
  } catch (cause) {
    if (active) error.value = (cause as Error).message;
  }
}

function changed() {
  studio.dirty = true;
}

function toggle(item: Entry) {
  const id = key(item);
  selected.value = selected.value.includes(id)
    ? selected.value.filter((entry) => entry !== id)
    : [...selected.value, id];
}

function selectRecommended() {
  selected.value = (info.value?.plan.items || []).map(key);
}

function selectOldFull() {
  selected.value = (info.value?.entries || [])
    .filter((item) => item.kind === "full" && !item.protected)
    .map(key);
}

async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    const next = await api("/storage/cleanup", "PATCH", {
      enabled: form.value.enabled,
      time: form.value.time,
      retainDays: Number(form.value.retainDays),
      keepFull: Number(form.value.keepFull),
    });
    info.value = next;
    form.value = { ...next.policy };
    studio.dirty = false;
    toast(t("备份整理规则已保存"));
  } catch (cause) {
    toast((cause as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function clean() {
  if (!chosen.value.length || busy.value) return;
  const items = chosen.value.map(({ scope, name, bytes, modified }) => ({
    scope,
    name,
    bytes,
    modified,
  }));
  if (
    !(await ask(
      t(
        "将清理选中的 {count} 份备份，释放约 {size}。这些历史恢复点清理后无法从本机找回。",
        {
          count: items.length,
          size: size(chosenBytes.value),
        },
      ),
      { title: t("清理所选备份"), confirmText: t("清理所选"), danger: true },
    ))
  )
    return;
  busy.value = true;
  try {
    const result = await api("/storage/cleanup/manual", "POST", { items });
    selected.value = [];
    await load();
    toast(
      t("已清理 {count} 份备份，释放 {size}", {
        count: result.removed.length,
        size: size(result.bytes),
      }),
    );
  } catch (cause) {
    toast((cause as Error).message, true);
    await load();
  } finally {
    busy.value = false;
  }
}

onMounted(() => load(true));
onBeforeUnmount(() => {
  active = false;
});
</script>

<template>
  <div class="storage-page">
    <section class="card storage-overview">
      <span class="eyebrow">{{ t("DATA · 数据与备份") }}</span>
      <h2>{{ t("留住重要的，整理重复的。") }}</h2>
      <p>
        {{
          t(
            "这里管理历史备份。聊天、记忆和作品仍在正在运行的数据库里，不会被列入清理。",
          )
        }}
      </p>
      <div v-if="info" class="storage-metrics">
        <div>
          <b>{{ size(info.totalBytes) }}</b
          ><span>{{ t("可管理的历史备份") }}</span>
        </div>
        <div>
          <b>{{ info.entries.length }}</b
          ><span>{{ t("份数据库副本") }}</span>
        </div>
        <div>
          <b>{{ size(info.plan.bytes) }}</b
          ><span>{{ t("按当前规则可定时整理") }}</span>
        </div>
      </div>
    </section>

    <p v-if="error" class="storage-error" role="alert">{{ error }}</p>
    <div v-if="info" class="storage-grid">
      <form class="card storage-policy" @submit.prevent="save">
        <div class="card-head">
          <div>
            <span class="eyebrow">{{ t("定时整理") }}</span>
            <h2>{{ t("每天给备份留一点空间") }}</h2>
          </div>
        </div>
        <label class="storage-check"
          ><input v-model="form.enabled" type="checkbox" @change="changed" />{{
            t("启用定时整理")
          }}</label
        >
        <div class="storage-fields">
          <label
            >{{ t("每天执行时间")
            }}<input
              v-model="form.time"
              type="text"
              inputmode="numeric"
              maxlength="5"
              placeholder="04:30"
              :aria-label="t('每天执行时间')"
              @input="changed"
          /></label>
          <label
            >{{ t("完整备份保留天数")
            }}<input
              v-model.number="form.retainDays"
              type="number"
              min="1"
              max="3650"
              :aria-label="t('完整备份保留天数')"
              @input="changed"
          /></label>
          <label
            >{{ t("至少保留最近几份完整备份")
            }}<input
              v-model.number="form.keepFull"
              type="number"
              min="2"
              max="100"
              :aria-label="t('至少保留最近几份完整备份')"
              @input="changed"
          /></label>
        </div>
        <p class="storage-note">
          {{
            t(
              "时间按服务器本地时区 {zone}。只有超过保留天数的完整备份会定时整理；最近两份自动备份、最近两份完整备份和最新迁移快照受到保护。执行前会校验近期自动备份。",
              { zone: info.serverTimeZone },
            )
          }}
        </p>
        <p v-if="info.last" class="storage-note">
          {{
            info.last.error
              ? t("上次整理未执行：{error}", { error: info.last.error })
              : t("上次整理：{time} · {count} 份 · {size}", {
                  time: date(info.last.at),
                  count: info.last.removed,
                  size: size(info.last.bytes),
                })
          }}
        </p>
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? t("处理中…") : t("保存整理规则") }}
        </button>
      </form>

      <section class="card storage-list">
        <div class="card-head">
          <div>
            <span class="eyebrow">{{ t("手动整理") }}</span>
            <h2>{{ t("挑选历史恢复点") }}</h2>
          </div>
        </div>
        <p class="storage-note">
          {{
            t(
              "自动备份已有自己的轮换规则。迁移、旧版本和升级前快照只由你手动挑选；清理前会再次核对文件和恢复点。",
            )
          }}
        </p>
        <div class="storage-actions">
          <button
            type="button"
            :disabled="busy || !info.plan.items.length"
            @click="selectRecommended"
          >
            {{ t("选中规则建议") }}
          </button>
          <button type="button" :disabled="busy" @click="selectOldFull">
            {{ t("选中旧完整备份") }}
          </button>
          <button
            type="button"
            :disabled="busy || !selected.length"
            @click="selected = []"
          >
            {{ t("取消选择") }}
          </button>
        </div>
        <div class="storage-scroll">
          <label
            v-for="item in info.entries"
            :key="key(item)"
            class="storage-row"
            :class="{ protected: item.protected }"
          >
            <input
              type="checkbox"
              :checked="selected.includes(key(item))"
              :disabled="busy || item.protected || info.running"
              :aria-label="item.name"
              @change="toggle(item)"
            />
            <span class="storage-item"
              ><strong>{{ item.name }}</strong
              ><small
                >{{ label(item.kind) }} · {{ date(item.at) }} ·
                {{ item.manifest ? t("有校验清单") : t("旧备份无清单")
                }}{{ item.protected ? " · " + t("保留恢复点") : "" }}</small
              ></span
            >
            <b>{{ size(item.bytes) }}</b>
          </label>
        </div>
        <div class="storage-footer">
          <span>{{
            t("已选 {count} 份 · 约 {size}", {
              count: chosen.length,
              size: size(chosenBytes),
            })
          }}</span>
          <button
            class="primary"
            type="button"
            :disabled="busy || info.running || !chosen.length"
            @click="clean"
          >
            {{ t("清理所选") }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.storage-page {
  display: grid;
  gap: var(--gap);
}
.storage-page > .card,
.storage-grid > .card {
  background:
    radial-gradient(
      ellipse at 100% 0,
      color-mix(in srgb, var(--glow-a) 20%, transparent),
      transparent 60%
    ),
    var(--surface);
}
.storage-overview h2 {
  font-size: clamp(24px, 3vw, 36px);
  margin: 8px 0;
}
.storage-overview p,
.storage-note {
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.65;
}
.storage-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}
.storage-metrics > div {
  display: grid;
  min-width: 150px;
  gap: 3px;
  padding: 15px 20px;
  border: 1px solid rgb(255 255 255 / 0.8);
  border-radius: 18px;
  background: rgb(255 255 255 / 0.42);
}
.storage-metrics b {
  color: var(--accent);
  font-size: 23px;
}
.storage-metrics span {
  color: var(--ink-soft);
  font-size: 12px;
}
.storage-grid {
  display: grid;
  grid-template-columns: minmax(270px, 0.8fr) minmax(0, 1.5fr);
  gap: var(--gap);
  align-items: start;
}
.storage-grid .card-head h2 {
  font-size: 23px;
  margin: 4px 0 16px;
}
.storage-check {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 16px;
}
.storage-fields {
  display: grid;
  gap: 13px;
}
.storage-fields label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 700;
}
.storage-fields input {
  width: 100%;
  min-width: 0;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, white);
  border-radius: 15px;
  background: rgb(255 255 255 / 0.7);
  color: var(--ink);
}
.storage-policy .primary {
  margin-top: 14px;
}
.storage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.storage-actions button {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.65);
}
.storage-scroll {
  max-height: 520px;
  overflow: auto;
  display: grid;
  gap: 7px;
  padding: 2px;
}
.storage-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgb(255 255 255 / 0.75);
  border-radius: 16px;
  background: rgb(255 255 255 / 0.48);
  cursor: pointer;
}
.storage-row.protected {
  opacity: 0.7;
  cursor: default;
}
.storage-item {
  display: grid;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.storage-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.storage-item small {
  font-size: 11px;
  color: var(--ink-soft);
}
.storage-row > b {
  white-space: nowrap;
  font-size: 12px;
  color: var(--accent);
}
.storage-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 18px;
  color: var(--ink-soft);
  font-size: 12px;
}
.storage-error {
  color: var(--danger);
}
@media (max-width: 900px) {
  .storage-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 560px) {
  .storage-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .storage-row > b {
    margin-left: 26px;
  }
  .storage-metrics > div {
    flex: 1;
    min-width: 130px;
  }
}
</style>
