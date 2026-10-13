<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { t, N_, localized } from "../../i18n";
import { api, toast } from "../../api";
import { when } from "../../plates/mind";
import { ask } from "../../dialog";
import Toggle from "../../components/ui/Toggle.vue";
import Select from "../../components/ui/Select.vue";

const state = ref<any>(null);
const busy = ref(false);
const installing = ref(false);
let poll: ReturnType<typeof setTimeout> | undefined,
  disposed = false;
const progress: Record<string, string> = localized({
  queued: N_("更新已开始"),
  downloading: N_("正在下载新版本…"),
  checking: N_("正在检查新程序…"),
  stopping: N_("正在保存当下并停止实例…"),
  backup: N_("正在保留更新前的校验备份…"),
  migrating: N_("正在整理并校验记忆与数据…"),
  restarting: N_("正在切换版本并重启…"),
  verifying: N_("正在确认新实例就绪…"),
  restoring: N_("正在恢复原版本和数据…"),
  done: N_("更新与重启已完成"),
  error: N_("更新未完成"),
});
const stages: Record<string, string> = localized({
  queued: N_("准备更新"),
  downloading: N_("下载新版本"),
  checking: N_("检查新程序"),
  stopping: N_("停止旧实例"),
  backup: N_("保存校验备份"),
  migrating: N_("迁移记忆与数据"),
  restarting: N_("切换并重启"),
  verifying: N_("检查新实例"),
  restoring: N_("恢复原版本"),
});
function active(operation: any) {
  return operation && !["done", "error"].includes(operation.status);
}
async function watchUpdate() {
  if (disposed) return;
  try {
    const next = await api("/system/update");
    state.value = next;
    if (next.operation?.status === "done") {
      installing.value = false;
      location.reload();
      return;
    }
    installing.value = !!active(next.operation);
  } catch {
    /* A planned restart makes the API temporarily unavailable. */
  }
  if (installing.value && !disposed) poll = setTimeout(watchUpdate, 1800);
}
onUnmounted(() => {
  disposed = true;
  clearTimeout(poll);
});
const labels: Record<string, string> = localized({
  unchecked: N_("尚未检查更新"),
  available: N_("有新版本可用"),
  current: N_("已是最新发布版本"),
  ahead: N_("当前版本领先于 npm 发布版本"),
  unavailable: N_("暂时无法检查更新"),
});
onMounted(async () => {
  try {
    adopt(await api("/system/update"));
    installing.value = !!active(state.value.operation);
    if (installing.value) poll = setTimeout(watchUpdate, 1800);
  } catch (error) {
    toast((error as Error).message, true);
  }
});
async function check() {
  if (busy.value) return;
  busy.value = true;
  try {
    state.value = await api("/system/update/check", "POST", {});
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
const auto = ref<any>({
  enabled: false,
  mode: "daily",
  at: "04:00",
  everyHours: 24,
  install: "notify",
  window: "",
});
const autoResults: Record<string, string> = localized({
  current: N_("已是最新"),
  available: N_("发现新版本，已提醒"),
  started: N_("已开始自动更新"),
  failed: N_("自动更新失败"),
  "rolled-back": N_("更新失败，已恢复原版本"),
  deferred: N_("一直没有合适时机，本次放弃"),
  skipped: N_("该版本失败过，不再自动重试"),
  "check-failed": N_("检查失败"),
});
function adopt(next: any) {
  state.value = next;
  if (next?.auto?.settings) auto.value = { ...next.auto.settings };
}
async function saveAuto() {
  try {
    adopt(await api("/system/update/auto", "POST", auto.value));
    toast(t("自动更新设置已保存"));
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function install() {
  if (installing.value || busy.value || state.value?.status !== "available")
    return;
  if (
    !(await ask(
      t(
        "更新到 {version} 并重启当前实例？先下载校验，再保留数据恢复点；启动失败时尝试恢复原版本。",
        { version: state.value.latest },
      ),
      { title: t("更新并重启"), confirmText: t("开始更新") },
    ))
  )
    return;
  installing.value = true;
  try {
    state.value.operation = await api("/system/update/install", "POST", {
      version: state.value.latest,
    });
    poll = setTimeout(watchUpdate, 800);
  } catch (e) {
    installing.value = false;
    toast((e as Error).message, true);
  }
}
</script>

<template>
  <section class="card update-settings" aria-labelledby="update-title">
    <header>
      <div>
        <span class="eyebrow">LUCKYTRI / VERSION</span>
        <h2 id="update-title">{{ t("版本与更新") }}</h2>
      </div>
      <button :disabled="busy || installing || !state" @click="check">
        {{ busy ? t("正在检查…") : t("检查更新") }}
      </button>
    </header>
    <template v-if="state">
      <p
        class="version-state"
        :class="{ available: state.status === 'available' }"
        role="status"
      >
        {{ labels[state.status] || labels.unchecked }}
      </p>
      <dl class="kv">
        <dt>{{ t("当前版本") }}</dt>
        <dd>{{ state.current }}</dd>
        <dt>{{ t("npm 最新版本") }}</dt>
        <dd>{{ state.latest || "—" }}</dd>
        <dt>{{ t("上次成功检查") }}</dt>
        <dd>{{ state.checkedAt ? when(state.checkedAt) : "—" }}</dd>
      </dl>
      <p v-if="state.error" class="muted" role="alert">
        {{ t("暂时无法连接 npm 或读取版本信息，请稍后重试。") }}
      </p>
      <p class="muted small-text">
        {{ t("点击时才检查，五分钟内复用结果。检查更新不会自动安装或重启。") }}
      </p>
      <div
        v-if="state.status === 'available' || state.operation"
        class="update-how stack tight"
      >
        <p>
          {{
            t(
              "下载期间继续运行，切换前保留数据恢复点。更新完成后此页面会自动重新连接。",
            )
          }}
        </p>
        <button
          v-if="state.status === 'available'"
          class="primary"
          :disabled="installing || busy"
          @click="install"
        >
          {{ installing ? t("正在更新…") : t("更新并重启") }}
        </button>
        <p v-if="state.operation" role="status">
          {{ progress[state.operation.status] }} · {{ state.operation.version }}
        </p>
        <p v-if="state.operation?.error" class="error-text" role="alert">
          {{ state.operation.error }}
        </p>
        <template v-if="state.operation?.status === 'error'">
          <p v-if="stages[state.operation.failedStage]" class="error-text">
            {{
              t("失败阶段：{stage}", {
                stage: stages[state.operation.failedStage],
              })
            }}
          </p>
          <p v-if="state.operation.detail" class="error-text">
            {{ state.operation.detail }}
          </p>
          <p v-if="state.operation.recoveryDetail" class="error-text">
            {{ state.operation.recoveryDetail }}
          </p>
        </template>
        <p v-if="state.operation?.restored" class="muted">
          {{ t("已恢复原版本和更新前的数据。") }}
        </p>
      </div>
      <div v-if="state.auto" class="update-how stack tight auto-update">
        <Toggle v-model="auto.enabled" name="auto-update" @change="saveAuto">
          <b>{{ t("自动检查更新") }}</b>
          <small>{{
            t(
              "默认关闭。到点检查；自动安装会等 TA 不在聊天、没有备份或迁移时再进行，失败自动恢复原版本。",
            )
          }}</small>
        </Toggle>
        <template v-if="auto.enabled">
          <label>
            {{ t("检查方式") }}
            <Select
              v-model="auto.mode"
              :aria-label="t('检查方式')"
              :options="[
                { value: 'daily', label: t('每天固定时间') },
                { value: 'interval', label: t('每隔一段时间') },
              ]"
              @update:model-value="saveAuto"
            />
          </label>
          <label v-if="auto.mode === 'daily'">
            {{ t("检查时间") }}
            <input v-model="auto.at" type="time" @change="saveAuto" />
          </label>
          <label v-else>
            {{ t("间隔") }}
            <Select
              v-model="auto.everyHours"
              :aria-label="t('间隔')"
              :options="
                [6, 12, 24, 72].map((h) => ({
                  value: h,
                  label: t('{hours} 小时', { hours: h }),
                }))
              "
              @update:model-value="saveAuto"
            />
          </label>
          <label>
            {{ t("发现新版本时") }}
            <Select
              v-model="auto.install"
              :aria-label="t('发现新版本时')"
              :disabled="state.installation !== 'npm'"
              :options="[
                { value: 'notify', label: t('只提醒') },
                { value: 'auto', label: t('自动安全更新') },
              ]"
              @update:model-value="saveAuto"
            />
          </label>
          <label>
            {{ t("允许更新的时段（可空，如 02:00-06:00）") }}
            <input
              v-model="auto.window"
              placeholder="02:00-06:00"
              @change="saveAuto"
            />
          </label>
          <p v-if="state.auto.waiting" class="muted" role="status">
            {{
              t("等待合适时机：{reason}", {
                reason: state.auto.waiting.reason || "—",
              })
            }}
          </p>
          <ul v-if="state.auto.history.length" class="muted small-text">
            <li v-for="h in state.auto.history.slice(0, 5)" :key="h.time">
              {{ when(h.time) }} · {{ autoResults[h.result] || h.result }}
              {{ h.to ? `· ${h.to}` : "" }}
            </li>
          </ul>
        </template>
      </div>
      <nav class="update-links">
        <a :href="state.npmUrl" target="_blank" rel="noopener noreferrer">npm</a
        ><a :href="state.releaseUrl" target="_blank" rel="noopener noreferrer"
          >{{ t("发布说明") }} ↗</a
        >
      </nav>
    </template>
  </section>
</template>

<style scoped>
.update-settings {
  display: grid;
  gap: 14px;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
h2 {
  margin-top: 5px;
}
.version-state {
  font-weight: 700;
}
.version-state.available {
  color: var(--accent);
}
.small-text {
  font-size: 12px;
}
.update-how {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
}
code {
  display: block;
  margin-top: 9px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.update-links {
  display: flex;
  gap: 18px;
  font-size: 13px;
}
</style>
