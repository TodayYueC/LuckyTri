<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api, clearReads, toast } from "../../api";
import { waitForAccess, requireLogin } from "../../access";
import { ask } from "../../dialog";
import { t, locale } from "../../i18n";

type Job = {
  id: string;
  status: string;
  name: string;
  error?: string;
  originalVersion?: number;
  summary?: {
    name: string;
    schemaVersion: number;
    tables: Record<string, number>;
  };
};
const info = ref<{
  available: boolean;
  maxBytes: number;
  lastImport?: Job;
} | null>(null);
const preview = ref<Job | null>(null);
const input = ref<HTMLInputElement>();
const phase = ref("");
const error = ref("");
let alive = true;
let controller: AbortController | null = null;
const busy = computed(() => !!phase.value);
const progress = computed(() =>
  phase.value === "restarting"
    ? t("正在保留快照并重启加载，请等待…")
    : phase.value === "uploading"
      ? t("正在上传数据文件…")
      : phase.value === "exporting"
        ? t("正在生成完整数据包…")
        : t("正在校验数据文件…"),
);
const counts = computed(() => {
  const tables = preview.value?.summary?.tables || {};
  return [
    [t("聊天记录"), tables.core_events || tables.messages || 0],
    [t("记忆"), tables.core_memories || tables.memories || 0],
    [t("待办"), tables.mind_time_tasks || 0],
    [t("作品"), tables.mind_time_works || 0],
    [t("日记"), tables.mind_diary || 0],
  ];
});
const delay = () => new Promise((resolve) => setTimeout(resolve, 800));
async function wait(id: string, restarting = false): Promise<Job> {
  for (let attempt = 0; attempt < 4500 && alive; attempt++) {
    try {
      const job: Job = await api("/storage/transfer/jobs/" + id);
      if (job.status === "error") throw Error(job.error || t("数据处理失败"));
      if (job.status === (restarting ? "done" : "ready")) return job;
      if (job.status === "expired")
        throw Error(t("数据文件已过期，请重新选择"));
    } catch (cause) {
      if (
        !restarting ||
        (!(cause instanceof TypeError) &&
          (cause as Error).message !== t("请求失败"))
      )
        throw cause;
    }
    await delay();
  }
  throw Error(t("等待数据处理超时，请检查实例运行状态"));
}
async function exportData() {
  if (busy.value) return;
  phase.value = "exporting";
  error.value = "";
  try {
    const job = await api("/storage/transfer/export", "POST", {});
    await wait(job.id);
    if (!alive) return;
    const link = document.createElement("a");
    link.href = "/api/storage/transfer/download/" + job.id;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast(t("数据包已生成，浏览器将开始下载"));
  } catch (cause) {
    if (alive) error.value = (cause as Error).message;
  } finally {
    if (alive) phase.value = "";
  }
}
async function pick(event: Event) {
  const element = event.target as HTMLInputElement;
  const file = element.files?.[0];
  element.value = "";
  if (!file || busy.value) return;
  error.value = "";
  preview.value = null;
  if (file.size > (info.value?.maxBytes || 0)) {
    error.value = t("数据文件超过导入大小限制");
    return;
  }
  phase.value = "uploading";
  controller = new AbortController();
  try {
    await waitForAccess();
    const response = await fetch("/api/storage/transfer/upload", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-LuckyTri-Filename": encodeURIComponent(file.name),
        "X-LuckyTri-Locale": locale.value,
      },
      body: file,
      signal: controller.signal,
    });
    if (response.status === 401) {
      requireLogin();
      throw Error(t("请先登录管理台"));
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || t("数据上传失败"));
    phase.value = "checking";
    const job = await wait(data.id);
    if (alive) preview.value = job;
  } catch (cause) {
    if (alive) error.value = (cause as Error).message;
  } finally {
    controller = null;
    if (alive) phase.value = "";
  }
}
async function cancel() {
  if (!preview.value || busy.value) return;
  try {
    await api("/storage/transfer/jobs/" + preview.value.id, "DELETE");
    preview.value = null;
  } catch (cause) {
    error.value = (cause as Error).message;
  }
}
async function importData() {
  if (!preview.value || busy.value) return;
  if (
    !(await ask(
      t(
        "用这份数据替换当前数据，并保留导入前快照。实例将重启，导入后自动回复关闭。本机管理密码与 QQ 连接配置保持不变。",
      ),
      { title: t("确认导入数据"), confirmText: t("导入并重启"), danger: true },
    ))
  )
    return;
  phase.value = "restarting";
  error.value = "";
  const id = preview.value.id;
  try {
    await api("/storage/transfer/import", "POST", { id });
    await wait(id, true);
    if (!alive) return;
    clearReads();
    location.reload();
  } catch (cause) {
    if (alive) error.value = (cause as Error).message;
  } finally {
    if (alive) phase.value = "";
  }
}
onMounted(async () => {
  try {
    info.value = await api("/storage/transfer");
  } catch (cause) {
    if (alive) error.value = (cause as Error).message;
  }
});
onBeforeUnmount(() => {
  alive = false;
  controller?.abort();
});
</script>

<template>
  <section
    v-if="info?.available"
    class="card data-transfer"
    aria-labelledby="data-transfer-title"
  >
    <span class="eyebrow">{{ t("DATA · 导入与导出") }}</span>
    <h2 id="data-transfer-title">{{ t("带上记忆，继续生活。") }}</h2>
    <p class="transfer-note">
      {{
        t(
          "导出数据库内的聊天、记忆、待办、作品、知识与设置。插件文件、知识库原始文件和本机 .env 不在数据包中。",
        )
      }}
    </p>
    <p class="transfer-note">
      {{
        t(
          "数据包包含私聊内容和模型设置中的密钥，请存放在你信任的位置。导入前会校验，确认后才替换当前数据。",
        )
      }}
    </p>
    <div class="transfer-actions">
      <button
        class="primary"
        type="button"
        :disabled="busy"
        @click="exportData"
      >
        {{ t("导出数据包") }}
      </button>
      <button type="button" :disabled="busy" @click="input?.click()">
        {{ t("选择导入文件") }}
      </button>
      <input
        ref="input"
        class="transfer-file"
        type="file"
        accept=".luckytri,.db,.sqlite,.sqlite3"
        :aria-label="t('导入数据文件')"
        @change="pick"
      />
    </div>
    <p class="transfer-note">
      {{
        t(
          "支持 .luckytri 数据包和已有 SQLite 备份，单个文件最多 {size} GiB。",
          { size: (info.maxBytes / 1073741824).toFixed(0) },
        )
      }}
    </p>
    <p v-if="busy" class="transfer-progress" role="status">{{ progress }}</p>
    <p v-if="error" class="transfer-error" role="alert">{{ error }}</p>
    <p v-if="info.lastImport?.status === 'done'" class="transfer-note">
      {{
        t(
          "上次数据导入已完成，自动回复在导入时关闭。请检查连接、模型和待办后再开启；插件需重新安装或确认权限。",
        )
      }}
    </p>
    <div v-if="preview" class="transfer-preview">
      <span class="eyebrow">{{ t("校验通过 · 尚未导入") }}</span>
      <h3>{{ preview.summary?.name }}</h3>
      <p class="transfer-note">
        {{ preview.name }} ·
        {{
          t("数据库版本 {from} → {to}", {
            from: preview.originalVersion,
            to: preview.summary?.schemaVersion,
          })
        }}
      </p>
      <div class="transfer-counts">
        <div v-for="[label, count] in counts" :key="label">
          <b>{{ count }}</b
          ><span>{{ label }}</span>
        </div>
      </div>
      <div class="transfer-actions">
        <button
          class="primary"
          type="button"
          :disabled="busy"
          @click="importData"
        >
          {{ t("导入并重启") }}</button
        ><button type="button" :disabled="busy" @click="cancel">
          {{ t("取消导入") }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.data-transfer {
  min-width: 0;
}
.data-transfer h2 {
  font-size: clamp(23px, 3vw, 32px);
  margin: 8px 0 14px;
}
.transfer-note {
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.transfer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0;
}
.transfer-actions button {
  padding: 11px 17px;
  border-radius: 16px;
}
.transfer-actions button:not(.primary) {
  background: rgb(255 255 255 / 0.72);
}
.transfer-file {
  display: none;
}
.transfer-preview {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid rgb(255 255 255 / 0.85);
  border-radius: 22px;
  background: rgb(255 255 255 / 0.4);
  overflow-wrap: anywhere;
}
.transfer-preview h3 {
  margin: 8px 0;
}
.transfer-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.transfer-counts > div {
  display: grid;
  gap: 4px;
  padding: 12px;
  min-width: 70px;
  border-radius: 14px;
  background: rgb(255 255 255 / 0.65);
}
.transfer-counts b,
.transfer-progress {
  color: var(--accent);
}
.transfer-counts span {
  font-size: 12px;
  color: var(--ink-soft);
}
.transfer-error {
  color: var(--danger);
  overflow-wrap: anywhere;
}
</style>
