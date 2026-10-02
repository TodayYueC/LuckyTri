<script setup lang="ts">
import { t, N_, localized } from "../../i18n";
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { usePageActivity } from "../../page-activity";
import { api, readSnapshot, toast } from "../../api";
import { go, setSub, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { when } from "../../plates/mind";
import { askText } from "../../dialog";
import Tabs from "../../components/ui/Tabs.vue";
import Empty from "../../components/ui/Empty.vue";
import Sheet from "../../components/ui/Sheet.vue";
import Select from "../../components/ui/Select.vue";
import DayAgenda from "./DayAgenda.vue";
import ExperienceLog from "./ExperienceLog.vue";
const views = ["today", "tasks", "works", "projects", "experiences"],
  view = ref(
    views.includes(studio.sub.split("/")[0])
      ? studio.sub.split("/")[0]
      : "today",
  );
const overview = shallowRef<any>(readSnapshot("/mind/time")),
  rows = shallowRef<any[]>([]),
  loading = ref(false),
  error = ref(""),
  offset = ref(0),
  q = ref(""),
  state = ref(""),
  taskFocus = ref(
    studio.sub.split("/")[0] === "tasks" ? studio.sub.split("/")[1] || "" : "",
  ),
  piece = shallowRef<any>(null),
  project = shallowRef<any>(null),
  source = shallowRef<any>(null),
  busy = ref(false),
  hasMore = ref(false),
  settingsDirty = ref(false),
  settingsSaving = ref(false),
  settings = ref<any>({
    focusMinutes: 25,
    breakMinutes: 5,
    stepMinutes: 5,
    paceSpeed: 1.25,
    ownPlanMinutes: 45,
    commitmentReviewMinutes: 30,
  });
const zone = computed(() => presence.data?.clock?.timeZone || "Asia/Shanghai");
const labels: Record<string, string> = localized({
  todo: N_("ToDo · 待办"),
  scheduled: N_("Scheduled · 已安排"),
  doing: N_("Doing · 正在做"),
  paused: N_("Paused · 暂停"),
  waiting: N_("Waiting · 等待"),
  done: N_("Done · 已完成"),
  abandoned: N_("Abandoned · 已放下"),
});
const shares: Record<string, string> = localized({
  none: "",
  waiting: N_("完成，尚未交付"),
  deferred: N_("暂缓交付"),
  declined: N_("暂不分享"),
  pending: N_("待继续交付"),
  sent: N_("已完整交付"),
  reported: N_("已整理并汇报"),
  uncertain: N_("送达不确定，等待核对"),
  sending: N_("正在交付"),
});
const priorities: Record<number, string> = localized({
  0: N_("低"),
  1: N_("普通"),
  2: N_("高"),
  3: N_("最高"),
});
function taskLabel(row: any) {
  if (row.state === "waiting")
    return row.waitKind === "adjust"
      ? t("需要调整约定")
      : row.waitKind === "specify"
        ? t("待想具体")
        : t("Waiting · 等条件");
  if (row.state === "todo" && !row.schedule?.chosenAt)
    return t("ToDo · 待选时间");
  if (row.state === "scheduled") return t("Scheduled · 已选时间");
  if (row.state === "paused") return t("Paused · 进度保留");
  return labels[row.state];
}
async function setPriority(row: any, priority: number) {
  try {
    await api("/mind/time/tasks/" + row.id + "/control", "POST", {
      action: "priority",
      priority,
    });
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
const minutes = (n: number) =>
  t("{v} 分钟", { v: Math.floor((n || 0) / 60000) });
const duration = (n: number) =>
  t("{v} 分钟", { v: Math.ceil((n || 0) / 60000) });
let sequence = 0;
function path() {
  const params = new URLSearchParams({
    limit: "24",
    offset: String(offset.value),
  });
  if (q.value) params.set("q", q.value);
  if (view.value === "tasks" && state.value) params.set("state", state.value);
  if (view.value === "tasks" && taskFocus.value)
    params.set("id", taskFocus.value);
  return "/mind/time/" + view.value + "?" + params;
}
async function load() {
  const token = ++sequence;
  const endpoint = view.value === "today" ? "/mind/time" : path();
  const cached = readSnapshot(endpoint);
  if (cached) {
    if (view.value === "today") overview.value = cached;
    else rows.value = cached;
  }
  loading.value = !cached;
  error.value = "";
  try {
    const data = await api(endpoint);
    if (token !== sequence) return;
    if (view.value === "today") {
      overview.value = data;
      if (!settingsDirty.value) settings.value = { ...data.settings };
    } else {
      rows.value = data;
      hasMore.value = data.length === 24;
    }
  } catch (e) {
    if (token === sequence) error.value = (e as Error).message;
  } finally {
    if (token === sequence) loading.value = false;
  }
}
async function openWork(id: string, version?: number) {
  busy.value = true;
  try {
    piece.value = await api(
      "/mind/time/works/" +
        encodeURIComponent(id) +
        (version ? "?version=" + version : ""),
    );
    project.value = null;
    source.value = null;
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function openProject(id: string) {
  try {
    const p = await api("/mind/time/projects/" + id);
    const [works, sources] = await Promise.all([
      api("/mind/time/works?project=" + id),
      api("/mind/time/projects/" + id + "/sources"),
    ]);
    project.value = { ...p, works, sources };
    piece.value = null;
    source.value = null;
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function openSource(id: string) {
  try {
    source.value = await api("/mind/time/sources/" + id);
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function control(row: any, action: string) {
  let readyAt: string | undefined;
  let durationMinutes: number | undefined;
  if (action === "schedule") {
    const date = await askText(
      t("最早开始时间（YYYY-MM-DD HH:mm）。截止时间保留原安排。"),
      {
        title: t("安排时间"),
        confirmText: t("继续"),
        placeholder: "2026-10-02 14:30",
      },
    );
    if (date === null) return;
    readyAt = date;
    const span = await askText(t("这次安排投入多少分钟（5 至 240）？"), {
      title: t("投入时间"),
      confirmText: t("继续"),
      placeholder: String(row.schedule?.durationMinutes || 25),
    });
    if (span === null) return;
    durationMinutes = Number(span);
  }
  const reason = await askText(
    action === "abandon"
      ? t("留下放下这件事的原因。")
      : t("留下这次调整的原因。"),
    {
      title: t("调整安排"),
      confirmText: t("保存"),
      placeholder: t("管理台调整"),
    },
  );
  if (reason === null) return;
  try {
    await api("/mind/time/tasks/" + row.id + "/control", "POST", {
      action,
      ...(readyAt ? { readyAt } : {}),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      reason: reason || t("管理台调整"),
    });
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function suggest(action: string) {
  if (!project.value) return;
  const idea = await askText(
    t("提出选题、续写方向或修改想法。她会自行决定是否采纳。"),
    { title: t("给她一个建议"), confirmText: t("留下建议") },
  );
  if (idea === null) return;
  try {
    const result = await api(
      "/mind/time/projects/" + project.value.id + "/suggest",
      "POST",
      { action, idea },
    );
    toast(
      result.duplicate
        ? t("这个项目已有待处理事项")
        : t("建议已保存，等待她的选择"),
    );
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function exportWork() {
  if (!piece.value) return;
  const p = piece.value;
  const blob = new Blob([p.title + "\n\n" + p.content], {
      type: "text/plain;charset=utf-8",
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download =
    p.title.replace(/[\\/:*?"<>|]/g, "_") + "-v" + p.version + ".txt";
  link.click();
  URL.revokeObjectURL(url);
}
async function saveSettings() {
  if (settingsSaving.value) return;
  settingsSaving.value = true;
  sequence++;
  try {
    const saved = await api("/mind/time/settings", "PUT", {
      ...settings.value,
    });
    sequence++;
    settings.value = saved;
    settingsDirty.value = false;
    toast(t("专注安排已保存"));
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    settingsSaving.value = false;
  }
}
function agendaTask(id: string) {
  taskFocus.value = id;
  if (view.value !== "tasks") view.value = "tasks";
  else void load();
  setSub("tasks/" + id);
}
async function requestCare() {
  try {
    await api("/mind/time/care", "POST", {});
    toast(t("已记下，空下来时回看说过的话"));
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function requestPlan() {
  try {
    await api("/mind/time/plan", "POST", {});
    toast(t("已记下，让她重新想具体时间与投入时长"));
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
function search() {
  offset.value = 0;
  void load();
}
watch(view, (next) => {
  if (studio.page !== "time") return;
  offset.value = 0;
  rows.value = [];
  q.value = "";
  state.value = "";
  if (next !== "tasks") taskFocus.value = "";
  setSub(
    next === "today"
      ? ""
      : next === "tasks" && taskFocus.value
        ? "tasks/" + taskFocus.value
        : next === "works" && studio.sub.startsWith("works/")
          ? studio.sub
          : next,
  );
  void load();
});
watch(
  () => [studio.page, studio.sub],
  ([page, sub]) => {
    if (page !== "time") return;
    const tab = sub.split("/")[0] || "today";
    if (tab === "tasks") {
      const id = sub.split("/")[1] || "";
      if (taskFocus.value !== id) {
        taskFocus.value = id;
        if (view.value === "tasks") void load();
      }
    }
    if (views.includes(tab)) view.value = tab;
    if (
      tab === "works" &&
      sub.split("/")[1] &&
      piece.value?.id !== sub.split("/")[1]
    )
      void openWork(sub.split("/")[1]);
  },
);
const pageVisible = usePageActivity("time", load);
let liveTimer = 0;
onMounted(() => {
  liveTimer = window.setInterval(() => {
    if (pageVisible.value && view.value === "today" && !document.hidden)
      void load();
  }, 5000);
  const id = studio.sub.split("/")[1];
  if (id && view.value === "works") void openWork(id);
});
onUnmounted(() => {
  clearInterval(liveTimer);
  sequence++;
});
</script>
<template>
  <div class="page time-page">
    <header class="time-intro">
      <div>
        <span class="eyebrow">{{ t("TIME · 时间") }}</span>
        <h1>
          {{ t("日子在走，") }}<em>{{ t("我也有自己的事。") }}</em>
        </h1>
        <p>{{ t("想做的事，正在留下的作品，与世界相遇的每一段。") }}</p>
      </div>
      <div class="time-clock" aria-hidden="true">
        <span>25</span><small>{{ t("留一点时间给自己") }}</small>
      </div>
    </header>
    <Tabs
      v-model="view"
      :label="t('时间的分区')"
      :items="[
        { key: 'today', label: t('今日') },
        { key: 'tasks', label: t('待办') },
        { key: 'works', label: t('作品库') },
        { key: 'projects', label: t('持续项目') },
        { key: 'experiences', label: t('体验记录') },
      ]"
    />
    <p v-if="error" class="card" role="alert">
      {{ error }} <button @click="load">{{ t("重试") }}</button>
    </p>
    <p v-if="loading" class="muted" role="status">
      {{ t("正在取回这段生活…") }}
    </p>
    <template v-if="view === 'today' && overview"
      ><section class="time-today">
        <article class="card main-activity">
          <span class="eyebrow">{{ t("此刻的主活动") }}</span
          ><template v-if="overview.current"
            ><h2>{{ overview.current.title || overview.current.label }}</h2>
            <span class="chip"
              >{{ overview.current.label }} ·
              {{
                overview.current.timing?.phase === "preparing"
                  ? t("正在准备")
                  : (overview.current.sessionElapsedMs ??
                        overview.current.elapsedMs) < 60000
                    ? t("刚开始这一段")
                    : t("本次已投入 ") +
                      minutes(
                        overview.current.sessionElapsedMs ??
                          overview.current.elapsedMs,
                      )
              }}</span
            >
            <p v-if="overview.current.schedule?.chosenAt" class="faint">
              {{
                t("她安排 {v} 开始，这次想投入 {durationMinutes} 分钟。", {
                  v: when(overview.current.schedule.proposedAt, zone),
                  durationMinutes: overview.current.schedule.durationMinutes,
                })
              }}
            </p>
            <p v-if="overview.current.timing?.plannedMs" class="faint">
              {{
                t("本段预计 {v} · 还需约 {v2}", {
                  v: duration(overview.current.timing.plannedMs),
                  v2: duration(overview.current.timing.remainingMs),
                })
              }}
            </p>
            <p>{{ overview.current.why || t("从自己的打算接着做。") }}</p>
            <p class="muted">
              {{ overview.current.checkpoint?.next || t("正在推进当前步骤。") }}
            </p>
            <button class="text-button" @click="view = 'tasks'">
              {{ t("查看安排 →") }}
            </button></template
          ><template v-else
            ><h2>
              {{ overview.agenda?.idle?.title || t("这会儿没有主活动") }}
            </h2>
            <p class="muted">
              {{
                overview.agenda?.idle?.reason ||
                t("自己选择接下来做什么，也可以歇着。")
              }}
            </p>
            <p v-if="overview.agenda?.idle?.next" class="faint">
              {{
                t("下一项：{title} · {v} 开始 · {durationMinutes} 分钟", {
                  title: overview.agenda.idle.next.title,
                  v: when(overview.agenda.idle.next.chosenStart, zone),
                  durationMinutes: overview.agenda.idle.next.durationMinutes,
                })
              }}
            </p>
            <button class="text-button" @click="requestPlan">
              {{ t("让她重新想想安排") }}
            </button></template
          >
        </article>
        <article class="card day-balance">
          <span class="eyebrow">{{ t("今天") }}</span>
          <h2>{{ minutes(overview.today?.activeMs) }}</h2>
          <p>
            {{
              t("实际活动投入 · {energyLabel} · {mood}", {
                energyLabel: overview.affect?.energyLabel,
                mood: overview.affect?.mood,
              })
            }}
          </p>
          <p class="muted">
            {{ t("普通交流可以伴随进行，短消息不会自动暂停。") }}
          </p>
          <button class="text-button" @click="go('life')">
            {{ t("翻开日记 →") }}
          </button>
        </article>
      </section>
      <DayAgenda
        v-if="overview.agenda"
        :agenda="overview.agenda"
        @task="agendaTask"
      />
      <section class="card own-care" v-if="overview.care">
        <span class="eyebrow">{{ t("独处时理一理") }}</span>
        <h2>{{ t("自己的打算，说过的约定") }}</h2>
        <p>
          {{
            t(
              "空下来时，她会想一件自己愿意做的小事，也会回看有没有漏下答应别人的事。可以选择歇着。",
            )
          }}
        </p>
        <p class="muted" v-if="overview.care.last">
          {{ t("最近：{reason}", { reason: overview.care.last.reason })
          }}<template v-if="overview.care.last.finished">
            · {{ when(overview.care.last.finished, zone) }}</template
          >
        </p>
        <p class="faint" v-if="overview.care.pendingReplies">
          {{
            t("还有 {pendingReplies} 条已说过的话等着分批回看。", {
              pendingReplies: overview.care.pendingReplies,
            })
          }}
        </p>
        <button
          :disabled="overview.care.queued || !!overview.care.working"
          @click="requestCare"
        >
          {{
            overview.care.working
              ? t("正在整理自己的生活")
              : overview.care.queued
                ? t("已记下，空下来时整理")
                : t("空下来整理一下约定")
          }}
        </button>
      </section>
      <details class="card time-settings">
        <summary>{{ t("专注与休息安排") }}</summary>
        <form
          @submit.prevent="saveSettings"
          @input="settingsDirty = true"
          @change="settingsDirty = true"
        >
          <label
            >{{ t("默认专注段（分钟）")
            }}<input
              v-model.number="settings.focusMinutes"
              type="number"
              min="1"
              max="120"
            /><small>{{
              t("没有另行选择时使用；她自己的安排优先。")
            }}</small></label
          ><label
            >{{ t("休息建议（分钟）")
            }}<input
              v-model.number="settings.breakMinutes"
              type="number"
              min="1"
              max="120" /></label
          ><label
            >{{ t("保存步骤间隔（分钟）")
            }}<input
              v-model.number="settings.stepMinutes"
              type="number"
              min="1"
              max="120"
          /></label>
          <label
            >{{ t("活动节奏")
            }}<input
              v-model.number="settings.paceSpeed"
              type="number"
              min="1"
              max="2"
              step="0.05"
            /><small>{{
              t("默认 1.25 倍，所有活动按现实时间逐段推进。")
            }}</small></label
          >
          <label
            >{{ t("想自己的安排（间隔分钟）")
            }}<input
              v-model.number="settings.ownPlanMinutes"
              type="number"
              min="1"
              max="120"
            /><small>{{ t("有空才考虑，可以决定休息。") }}</small></label
          >
          <label
            >{{ t("回看说过的话（间隔分钟）")
            }}<input
              v-model.number="settings.commitmentReviewMinutes"
              type="number"
              min="1"
              max="120"
            /><small>{{
              t("分批整理约定，保留去重与原来的选择。")
            }}</small></label
          >
          <button class="primary" :disabled="settingsSaving">
            {{ settingsSaving ? t("正在保存") : t("保存安排") }}
          </button>
        </form>
      </details></template
    >
    <template v-else-if="view !== 'today'"
      ><form class="time-filter" @submit.prevent="search">
        <button
          v-if="view === 'tasks' && taskFocus"
          type="button"
          @click="
            taskFocus = '';
            setSub('tasks');
            load();
          "
        >
          {{ t("查看全部待办") }}
        </button>
        <label v-if="['works', 'projects', 'experiences'].includes(view)"
          ><span class="sr-only">{{ t("搜索标题") }}</span
          ><input v-model="q" :placeholder="t('搜索标题或项目')" /><button>
            {{ t("搜索") }}
          </button></label
        ><label v-if="view === 'tasks'"
          >{{ t("任务状态")
          }}<Select
            v-model="state"
            :aria-label="t('任务状态')"
            :options="[
              { value: '', label: t('全部') },
              ...Object.entries(labels).map(([value, label]) => ({
                value,
                label,
              })),
            ]"
            @change="search"
        /></label>
      </form>
      <div v-if="view === 'tasks'" class="time-cards">
        <article
          v-for="row in rows"
          :key="row.id"
          class="card time-task"
          :data-task="row.id"
        >
          <div class="row task-meta">
            <span
              class="chip"
              :data-tone="row.state === 'done' ? 'ok' : 'quiet'"
              >{{ taskLabel(row) }}</span
            ><span class="faint"
              >{{
                row.kind === "promise"
                  ? t("答应的事")
                  : row.kind === "suggestion"
                    ? t("外部建议")
                    : t("自己的计划")
              }}{{ row.person ? " · " + row.person : "" }}</span
            ><label class="task-priority"
              ><span>{{ t("优先级") }}</span>
              <Select
                :model-value="row.priority"
                :aria-label="t('优先级：') + row.title"
                :options="
                  Object.entries(priorities).map(([value, label]) => ({
                    value,
                    label,
                  }))
                "
                :disabled="!!row.checkpoint?.mergedInto"
                @update:model-value="setPriority(row, Number($event))"
            /></label>
          </div>
          <h2>{{ row.title }}</h2>
          <p>{{ row.why }}</p>
          <p v-if="row.wait_reason" class="muted">{{ row.wait_reason }}</p>
          <p class="faint">
            <template
              v-if="row.schedule?.chosenAt && !row.checkpoint?.reschedule"
              >{{
                t("{v} {v2} — {v3} · 这次 {durationMinutes} 分钟", {
                  v:
                    row.schedule.chosenBy === "admin"
                      ? t("管理台安排")
                      : t("她选定"),
                  v2: when(row.schedule.proposedAt, zone),
                  v3: when(row.schedule.proposedEnd, zone),
                  durationMinutes: row.schedule.durationMinutes,
                })
              }}</template
            >
            <template v-else-if="row.schedule?.startedAt">{{
              t("本段开始 {v}", { v: when(row.schedule.startedAt, zone) })
            }}</template
            ><template v-else-if="row.schedule?.proposedAt"
              >{{
                row.schedule.conditional ? t("条件满足后建议") : t("已安排")
              }}
              {{ when(row.schedule.proposedAt, zone) }} —
              {{ when(row.schedule.proposedEnd, zone) }}</template
            ><template v-else>{{
              row.state === "waiting"
                ? t("需要解决上面的条件，再选择时间")
                : row.state === "paused"
                  ? t("进度已保存，之后再安排续接时间")
                  : t("已记下，等她选择具体时间")
            }}</template>
            <template v-if="row.timing?.plannedMs">
              {{
                t("· 本段预计 {v} · 本段已投入 {v2}", {
                  v: duration(row.timing.plannedMs),
                  v2: minutes(row.timing.stepMs),
                })
              }}<template v-if="row.timing.phase === 'engaged'">
                {{
                  t("· 还需约 {v}", { v: duration(row.timing.remainingMs) })
                }}</template
              ></template
            >
            <template v-else-if="row.timing?.phase === 'legacy'">
              {{ t("· 此前时长未单独记录") }}</template
            >
            <template v-else>
              ·
              {{
                row.state === "doing"
                  ? t("正在准备这一段")
                  : t("尚未开始本段投入")
              }}</template
            >
          </p>
          <p v-if="row.schedule?.outcome" class="muted">
            {{ t("本段目标：{outcome}", { outcome: row.schedule.outcome }) }}
          </p>
          <p v-if="shares[row.share_state]" class="share-status">
            {{ shares[row.share_state] }} {{ row.share_reason }}
          </p>
          <p v-if="row.checkpoint?.next" class="muted">
            {{ t("下一步：{next}", { next: row.checkpoint.next }) }}
          </p>
          <details class="task-sources">
            <summary>
              {{
                t("来源与原安排 · {length} 条", { length: row.sources.length })
              }}
            </summary>
            <p v-if="row.due_at" class="faint">
              {{
                t("原话日期参考 {v}，不作为逾期判断。", {
                  v: when(row.due_at, zone),
                })
              }}
            </p>
            <small class="faint">{{ row.sources.join(" · ") }}</small>
            <p v-if="row.checkpoint?.mergedInto" class="muted">
              {{ t("已合并到唯一事项，保留这条原记录。") }}
            </p>
          </details>
          <div class="row">
            <button v-if="row.work_id" @click="openWork(row.work_id)">
              {{ t("阅读已有正文") }}</button
            ><button v-if="row.project_id" @click="openProject(row.project_id)">
              {{ t("持续项目") }}</button
            ><template v-if="!['done', 'abandoned'].includes(row.state)"
              ><button
                v-if="row.state === 'doing'"
                @click="control(row, 'pause')"
              >
                {{ t("暂停") }}</button
              ><button v-else @click="control(row, 'resume')">
                {{ t("重新安排") }}</button
              ><button @click="control(row, 'schedule')">
                {{ t("安排时间") }}</button
              ><button class="text-button" @click="control(row, 'abandon')">
                {{ t("放下") }}
              </button></template
            >
          </div>
        </article>
      </div>
      <div v-else-if="view === 'works'" class="time-cards work-grid">
        <button
          v-for="row in rows"
          :key="row.id"
          class="card work-card"
          :data-work="row.id"
          @click="openWork(row.id)"
        >
          <span class="eyebrow">{{
            t("{v} · 第 {ordinal} 篇", {
              v: row.state === "complete" ? t("完成稿") : t("草稿"),
              ordinal: row.ordinal,
            })
          }}</span>
          <h2>{{ row.title }}</h2>
          <p>{{ row.summary }}</p>
          <small>{{
            t("{characters} 字 · 版本 {version}", {
              characters: row.characters,
              version: row.version,
            })
          }}</small
          ><span class="faint">{{
            row.project_title || t("独处留下的东西")
          }}</span>
        </button>
      </div>
      <div v-else-if="view === 'projects'" class="time-cards work-grid">
        <article v-for="row in rows" :key="row.id" class="card">
          <span class="eyebrow"
            >{{
              row.kind === "game"
                ? t("游戏")
                : row.serial
                  ? t("连载")
                  : t("持续项目")
            }}
            ·
            {{
              row.state === "active"
                ? t("在继续")
                : row.state === "complete"
                  ? t("已完结")
                  : t("暂时放下")
            }}</span
          >
          <h2>{{ row.title }}</h2>
          <p>{{ row.why }}</p>
          <p class="muted">{{ row.summary }}</p>
          <button @click="openProject(row.id)">{{ t("打开项目") }}</button>
        </article>
      </div>
      <ExperienceLog
        v-else
        :rows="rows"
        :zone="zone"
        :loading="loading"
        @work="openWork"
        @project="openProject"
        @source="openSource"
      />
      <Empty
        v-if="view !== 'experiences' && !loading && !rows.length"
        :title="
          view === 'works' ? t('作品还在等待第一笔') : t('这里还没有记录')
        "
        :text="t('实际发生并保存之后，这里才会出现内容。')"
      />
      <div class="row time-pagination">
        <button
          :disabled="offset === 0"
          @click="
            offset = Math.max(0, offset - 24);
            load();
          "
        >
          {{ t("上一页") }}</button
        ><span>{{ offset / 24 + 1 }}</span
        ><button
          :disabled="!hasMore"
          @click="
            offset += 24;
            load();
          "
        >
          {{ t("下一页") }}
        </button>
      </div></template
    >
    <Sheet
      :open="!!piece"
      :title="piece?.title || t('作品')"
      :eyebrow="t('她留下的正文')"
      width="780px"
      @close="piece = null"
      ><template v-if="piece"
        ><div class="row">
          <span class="chip">{{
            t("{v} · {length} 字", {
              v: piece.state === "complete" ? t("完成稿") : t("草稿"),
              length: piece.content.length,
            })
          }}</span
          ><label
            >{{ t("版本")
            }}<Select
              :model-value="piece.version"
              :aria-label="t('作品版本')"
              :options="
                piece.versions.map((v: any) => ({
                  value: v.version,
                  label: v.version + ' · ' + when(v.created, zone),
                }))
              "
              @update:model-value="openWork(piece.id, Number($event))" /></label
          ><button @click="exportWork">{{ t("导出正文") }}</button>
        </div>
        <p class="work-body">{{ piece.content }}</p>
        <button v-if="piece.project_id" @click="openProject(piece.project_id)">
          {{ t("查看项目与设定") }}
        </button></template
      ></Sheet
    >
    <Sheet
      :open="!!project"
      :title="project?.title || t('持续项目')"
      :eyebrow="t('她自己的方向')"
      width="740px"
      @close="project = null"
      ><template v-if="project"
        ><p>{{ project.why }}</p>
        <p class="muted">{{ project.summary }}</p>
        <details v-if="Object.keys(project.bible || {}).length">
          <summary>{{ t("设定与未解决线索") }}</summary>
          <dl>
            <template v-for="(value, key) in project.bible" :key="key"
              ><dt>
                {{
                  (
                    {
                      characters: t("人物"),
                      world: t("世界"),
                      threads: t("未解决线索"),
                      topic: t("资料主题"),
                      mode: t("模式"),
                    } as any
                  )[key] || key
                }}
              </dt>
              <dd>{{ value }}</dd></template
            >
          </dl>
        </details>
        <div class="row">
          <button @click="suggest('continue')">{{ t("建议续写") }}</button
          ><button @click="suggest('revise')">{{ t("建议修改") }}</button
          ><button @click="suggest('direction')">{{ t("建议方向") }}</button>
        </div>
        <h3>{{ t("已经留下的篇章") }}</h3>
        <ul class="list">
          <li v-for="item in project.works" :key="item.id">
            <button class="text-button" @click="openWork(item.id)">
              {{
                t("第 {ordinal} 篇 · {title}", {
                  ordinal: item.ordinal,
                  title: item.title,
                })
              }}</button
            ><small>{{
              item.state === "draft" ? t("草稿") : t("完成稿")
            }}</small>
          </li>
        </ul>
        <h3 v-if="project.sources.length">{{ t("接触的资料") }}</h3>
        <ul class="list">
          <li v-for="item in project.sources" :key="item.id">
            <button class="text-button" @click="openSource(item.id)">
              {{ item.title }}
            </button>
          </li>
        </ul></template
      ></Sheet
    >
    <Sheet
      :open="!!source"
      :title="source?.title || t('资料')"
      :eyebrow="
        source?.kind === 'model'
          ? t('模型知识整理 · 未经联网核验')
          : t('实际返回的摘录')
      "
      width="740px"
      @close="source = null"
      ><template v-if="source"
        ><a
          v-if="source.url"
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t("打开来源") }}</a
        >
        <p v-if="source.kind === 'model'" class="muted">
          {{
            source.uncertainty ||
            t("基于模型已有知识，具体剧情与章节仍需核验。")
          }}
        </p>
        <p class="faint">{{ when(source.created, zone) }}</p>
        <p class="work-body">{{ source.content }}</p></template
      ></Sheet
    >
  </div>
</template>
<style scoped src="./TimePage.css"></style>
