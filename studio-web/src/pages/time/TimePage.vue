<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { api, readSnapshot, toast } from "../../api";
import { go, setSub, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { when } from "../../plates/mind";
import { askText } from "../../dialog";
import Tabs from "../../components/ui/Tabs.vue";
import Empty from "../../components/ui/Empty.vue";
import Sheet from "../../components/ui/Sheet.vue";
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
  piece = shallowRef<any>(null),
  project = shallowRef<any>(null),
  source = shallowRef<any>(null),
  busy = ref(false),
  hasMore = ref(false),
  settings = ref<any>({ focusMinutes: 25, breakMinutes: 5, stepMinutes: 5 });
const zone = computed(() => presence.data?.clock?.timeZone || "Asia/Shanghai");
const labels: Record<string, string> = {
  todo: "ToDo · 待办",
  scheduled: "Scheduled · 已安排",
  doing: "Doing · 正在做",
  paused: "Paused · 暂停",
  waiting: "Waiting · 等待",
  done: "Done · 已完成",
  abandoned: "Abandoned · 已放下",
};
const shares: Record<string, string> = {
  none: "",
  waiting: "完成，尚未交付",
  deferred: "暂缓交付",
  declined: "暂不分享",
  pending: "待继续交付",
  sent: "已完整交付",
  uncertain: "送达不确定，等待核对",
  sending: "正在交付",
};
const priorities: Record<number, string> = {
  0: "低",
  1: "普通",
  2: "高",
  3: "最高",
};
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
const minutes = (n: number) => `${Math.floor((n || 0) / 60000)} 分钟`;
let sequence = 0;
function path() {
  const params = new URLSearchParams({
    limit: "24",
    offset: String(offset.value),
  });
  if (q.value) params.set("q", q.value);
  if (view.value === "tasks" && state.value) params.set("state", state.value);
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
      settings.value = { ...data.settings };
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
  if (action === "schedule") {
    const date = await askText(
      "最早开始时间（YYYY-MM-DD HH:mm）。截止时间保留原安排。",
      {
        title: "安排时间",
        confirmText: "继续",
        placeholder: "2026-10-02 14:30",
      },
    );
    if (date === null) return;
    readyAt = date;
  }
  const reason = await askText(
    action === "abandon" ? "留下放下这件事的原因。" : "留下这次调整的原因。",
    { title: "调整安排", confirmText: "保存", placeholder: "管理台调整" },
  );
  if (reason === null) return;
  try {
    await api("/mind/time/tasks/" + row.id + "/control", "POST", {
      action,
      ...(readyAt ? { readyAt } : {}),
      reason: reason || "管理台调整",
    });
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function suggest(action: string) {
  if (!project.value) return;
  const idea = await askText(
    "提出选题、续写方向或修改想法。她会自行决定是否采纳。",
    { title: "给她一个建议", confirmText: "留下建议" },
  );
  if (idea === null) return;
  try {
    const result = await api(
      "/mind/time/projects/" + project.value.id + "/suggest",
      "POST",
      { action, idea },
    );
    toast(
      result.duplicate ? "这个项目已有待处理事项" : "建议已保存，等待她的选择",
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
  try {
    settings.value = await api("/mind/time/settings", "PUT", settings.value);
    toast("专注安排已保存");
  } catch (e) {
    toast((e as Error).message, true);
  }
}
function search() {
  offset.value = 0;
  void load();
}
watch(view, (next) => {
  offset.value = 0;
  rows.value = [];
  q.value = "";
  state.value = "";
  setSub(next === "today" ? "" : next);
  void load();
});
watch(
  () => studio.sub,
  (sub) => {
    const tab = sub.split("/")[0] || "today";
    if (views.includes(tab)) view.value = tab;
  },
);
watch(
  () => [studio.tick, studio.pulse],
  () => void load(),
);
let liveTimer = 0;
onMounted(() => {
  liveTimer = window.setInterval(() => {
    if (view.value === "today" && !document.hidden) void load();
  }, 30000);
  void load();
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
        <span class="eyebrow">TIME · 时间</span>
        <h1>日子在走，<em>我也有自己的事。</em></h1>
        <p>想做的事，正在留下的作品，与世界相遇的每一段。</p>
      </div>
      <div class="time-clock" aria-hidden="true">
        <span>25</span><small>留一点时间给自己</small>
      </div>
    </header>
    <Tabs
      v-model="view"
      label="时间的分区"
      :items="[
        { key: 'today', label: '今日' },
        { key: 'tasks', label: '待办' },
        { key: 'works', label: '作品库' },
        { key: 'projects', label: '持续项目' },
        { key: 'experiences', label: '体验记录' },
      ]"
    />
    <p v-if="error" class="card" role="alert">
      {{ error }} <button @click="load">重试</button>
    </p>
    <p v-if="loading" class="muted" role="status">正在取回这段生活…</p>
    <template v-if="view === 'today' && overview"
      ><section class="time-today">
        <article class="card main-activity">
          <span class="eyebrow">此刻的主活动</span
          ><template v-if="overview.current"
            ><h2>{{ overview.current.title || overview.current.label }}</h2>
            <span class="chip"
              >{{ overview.current.label }} ·
              {{ minutes(overview.current.elapsedMs) }}</span
            >
            <p>{{ overview.current.why || "从自己的打算接着做。" }}</p>
            <p class="muted">
              {{ overview.current.checkpoint?.next || "正在推进当前步骤。" }}
            </p>
            <button class="text-button" @click="view = 'tasks'">
              查看安排 →
            </button></template
          ><Empty
            v-else
            title="留着一段自己的时间"
            text="待办会根据期限、精力和自己的愿望推进。"
          />
        </article>
        <article class="card day-balance">
          <span class="eyebrow">今天</span>
          <h2>{{ minutes(overview.today?.activeMs) }}</h2>
          <p>
            实际活动投入 · {{ overview.affect?.energyLabel }} ·
            {{ overview.affect?.mood }}
          </p>
          <p class="muted">普通交流可以伴随进行，短消息不会自动暂停。</p>
          <button class="text-button" @click="go('life')">翻开日记 →</button>
        </article>
      </section>
      <section class="card">
        <h2>今日的时间</h2>
        <p class="muted">
          连续时段是主活动，圆点是伴随交流。暂停、睡眠和停机不会补算。
        </p>
        <ol class="time-ledger" v-if="overview.today?.spans.length">
          <li v-for="span in overview.today.spans" :key="span.id">
            <div>
              <time>{{ when(span.started, zone) }}</time
              ><span
                class="time-span"
                :style="{
                  '--time-length':
                    Math.min(100, Math.max(8, (span.todayMs / 60000) * 2)) +
                    '%',
                }"
              ></span>
            </div>
            <div>
              <b>{{ span.title }}</b
              ><small
                >{{ minutes(span.todayMs) }} ·
                {{ span.ended ? "已结束" : "持续中" }}</small
              >
              <div class="interaction-points">
                <span
                  v-for="point in overview.today.interactions.filter(
                    (p: any) =>
                      p.task_id === span.task_id &&
                      p.created >= span.started &&
                      p.created <= (span.ended || overview.today.now),
                  )"
                  :key="point.id"
                  class="interaction-point"
                  :title="'伴随交流 · ' + when(point.created, zone)"
                ></span>
              </div>
            </div>
          </li>
        </ol>
        <Empty
          v-else
          title="今天还没有活动时段"
          text="实际开始后才会留下时间记录。"
        />
      </section>
      <section class="card">
        <h2>接下来想做</h2>
        <ul class="list" v-if="overview.next?.length">
          <li v-for="item in overview.next" :key="item.id">
            <b>{{ item.title }}</b
            ><span class="faint">{{ item.why }}</span>
          </li>
        </ul>
        <p class="muted" v-else>还没有可以立即开始的安排。</p>
      </section>
      <details class="card time-settings">
        <summary>专注与休息安排</summary>
        <form @submit.prevent="saveSettings">
          <label
            >专注段（分钟）<input
              v-model.number="settings.focusMinutes"
              type="number"
              min="1"
              max="120" /></label
          ><label
            >休息建议（分钟）<input
              v-model.number="settings.breakMinutes"
              type="number"
              min="1"
              max="120" /></label
          ><label
            >保存步骤间隔（分钟）<input
              v-model.number="settings.stepMinutes"
              type="number"
              min="1"
              max="120" /></label
          ><button class="primary">保存安排</button>
        </form>
      </details></template
    >
    <template v-else-if="view !== 'today'"
      ><form class="time-filter" @submit.prevent="search">
        <label v-if="['works', 'projects'].includes(view)"
          ><span class="sr-only">搜索标题</span
          ><input v-model="q" placeholder="搜索标题或项目" /><button>
            搜索
          </button></label
        ><label v-if="view === 'tasks'"
          >任务状态<select v-model="state" @change="search">
            <option value="">全部</option>
            <option v-for="(label, key) in labels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
      </form>
      <div v-if="view === 'tasks'" class="time-cards">
        <article
          v-for="row in rows"
          :key="row.id"
          class="card time-task"
          :data-task="row.id"
        >
          <div class="row">
            <span
              class="chip"
              :data-tone="row.state === 'done' ? 'ok' : 'quiet'"
              >{{ labels[row.state] }}</span
            ><span class="faint"
              >{{
                row.kind === "promise"
                  ? "答应的事"
                  : row.kind === "suggestion"
                    ? "外部建议"
                    : "自己的计划"
              }}{{ row.person ? " · " + row.person : "" }}</span
            ><label class="task-priority"
              >优先级
              <select
                :value="row.priority"
                :disabled="!!row.checkpoint?.mergedInto"
                @change="
                  setPriority(
                    row,
                    Number(($event.target as HTMLSelectElement).value),
                  )
                "
              >
                <option
                  v-for="(label, key) in priorities"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select></label
            >
          </div>
          <h2>{{ row.title }}</h2>
          <p>{{ row.why }}</p>
          <p v-if="row.wait_reason" class="muted">{{ row.wait_reason }}</p>
          <p class="faint">
            <template v-if="row.schedule?.startedAt"
              >本段开始 {{ when(row.schedule.startedAt, zone) }}</template
            ><template v-else-if="row.schedule?.proposedAt"
              >{{ row.schedule.conditional ? "条件满足后建议" : "已安排" }}
              {{ when(row.schedule.proposedAt, zone) }} —
              {{ when(row.schedule.proposedEnd, zone) }}</template
            ><template v-else>{{
              row.state === "waiting"
                ? "条件满足后再安排时间"
                : "按优先级选择可执行事项"
            }}</template>
            · 本段 {{ row.schedule?.focusMinutes || 25 }} 分钟 · 投入
            {{ minutes(row.elapsedMs) }}
          </p>
          <p v-if="row.schedule?.outcome" class="muted">
            本段目标：{{ row.schedule.outcome }}
          </p>
          <p v-if="row.checkpoint?.contract?.originalGoal" class="faint">
            {{
              row.checkpoint.contract.boundary ||
              "旧约定保留为来源；资料体验不等于真实游玩。"
            }}
          </p>
          <p v-if="shares[row.share_state]" class="share-status">
            {{ shares[row.share_state] }} {{ row.share_reason }}
          </p>
          <p v-if="row.checkpoint?.next" class="muted">
            下一步：{{ row.checkpoint.next }}
          </p>
          <details class="task-sources">
            <summary>来源与原安排 · {{ row.sources.length }} 条</summary>
            <p v-if="row.due_at" class="faint">
              原话日期参考 {{ when(row.due_at, zone) }}，不作为逾期判断。
            </p>
            <small class="faint">{{ row.sources.join(" · ") }}</small>
            <p v-if="row.checkpoint?.mergedInto" class="muted">
              已合并到唯一事项，保留这条原记录。
            </p>
          </details>
          <div class="row">
            <button v-if="row.work_id" @click="openWork(row.work_id)">
              阅读已有正文</button
            ><button v-if="row.project_id" @click="openProject(row.project_id)">
              持续项目</button
            ><template v-if="!['done', 'abandoned'].includes(row.state)"
              ><button
                v-if="row.state === 'doing'"
                @click="control(row, 'pause')"
              >
                暂停</button
              ><button v-else @click="control(row, 'resume')">重新安排</button
              ><button @click="control(row, 'schedule')">安排时间</button
              ><button class="text-button" @click="control(row, 'abandon')">
                放下
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
          <span class="eyebrow"
            >{{ row.state === "complete" ? "完成稿" : "草稿" }} · 第
            {{ row.ordinal }} 篇</span
          >
          <h2>{{ row.title }}</h2>
          <p>{{ row.summary }}</p>
          <small>{{ row.characters }} 字 · 版本 {{ row.version }}</small
          ><span class="faint">{{
            row.project_title || "独处留下的东西"
          }}</span>
        </button>
      </div>
      <div v-else-if="view === 'projects'" class="time-cards work-grid">
        <article v-for="row in rows" :key="row.id" class="card">
          <span class="eyebrow"
            >{{
              row.kind === "game"
                ? "游戏 · 资料模式"
                : row.serial
                  ? "连载"
                  : "持续项目"
            }}
            ·
            {{
              row.state === "active"
                ? "在继续"
                : row.state === "complete"
                  ? "已完结"
                  : "暂时放下"
            }}</span
          >
          <h2>{{ row.title }}</h2>
          <p>{{ row.why }}</p>
          <p class="muted">{{ row.summary }}</p>
          <button @click="openProject(row.id)">打开项目</button>
        </article>
      </div>
      <div v-else class="time-cards">
        <article v-for="row in rows" :key="row.id" class="card">
          <span class="eyebrow"
            >{{
              row.kind === "reference-experience" ? "资料体验" : "实际活动"
            }}
            · {{ when(row.created, zone) }}</span
          >
          <h2>{{ row.reason }}</h2>
          <p v-if="row.data.mode === 'reference'" class="muted">
            接触资料并留下感受，章节完整性尚未确认。
          </p>
          <div class="row">
            <button v-if="row.data.workId" @click="openWork(row.data.workId)">
              阅读记录</button
            ><button
              v-for="(id, index) in row.data.sourceIds || []"
              :key="id"
              @click="openSource(id)"
            >
              资料 {{ index + 1 }}
            </button>
          </div>
        </article>
        <section class="card real-mode">
          <h2>真实游玩</h2>
          <label class="check"
            ><input type="checkbox" disabled />启用真实游戏操作</label
          >
          <p class="muted">开发中 · 等待真实执行适配器。</p>
        </section>
      </div>
      <Empty
        v-if="!loading && !rows.length"
        :title="view === 'works' ? '作品还在等待第一笔' : '这里还没有记录'"
        text="实际发生并保存之后，这里才会出现内容。"
      />
      <div class="row time-pagination">
        <button
          :disabled="offset === 0"
          @click="
            offset = Math.max(0, offset - 24);
            load();
          "
        >
          上一页</button
        ><span>{{ offset / 24 + 1 }}</span
        ><button
          :disabled="!hasMore"
          @click="
            offset += 24;
            load();
          "
        >
          下一页
        </button>
      </div></template
    >
    <Sheet
      :open="!!piece"
      :title="piece?.title || '作品'"
      eyebrow="她留下的正文"
      width="780px"
      @close="piece = null"
      ><template v-if="piece"
        ><div class="row">
          <span class="chip"
            >{{ piece.state === "complete" ? "完成稿" : "草稿" }} ·
            {{ piece.content.length }} 字</span
          ><label
            >版本<select
              :value="piece.version"
              @change="
                openWork(
                  piece.id,
                  Number(($event.target as HTMLSelectElement).value),
                )
              "
            >
              <option
                v-for="v in piece.versions"
                :key="v.version"
                :value="v.version"
              >
                {{ v.version }} · {{ when(v.created, zone) }}
              </option>
            </select></label
          ><button @click="exportWork">导出正文</button>
        </div>
        <p class="work-body">{{ piece.content }}</p>
        <button v-if="piece.project_id" @click="openProject(piece.project_id)">
          查看项目与设定
        </button></template
      ></Sheet
    >
    <Sheet
      :open="!!project"
      :title="project?.title || '持续项目'"
      eyebrow="她自己的方向"
      width="740px"
      @close="project = null"
      ><template v-if="project"
        ><p>{{ project.why }}</p>
        <p class="muted">{{ project.summary }}</p>
        <details v-if="Object.keys(project.bible || {}).length">
          <summary>设定与未解决线索</summary>
          <dl>
            <template v-for="(value, key) in project.bible" :key="key"
              ><dt>
                {{
                  (
                    {
                      characters: "人物",
                      world: "世界",
                      threads: "未解决线索",
                      topic: "资料主题",
                      mode: "模式",
                    } as any
                  )[key] || key
                }}
              </dt>
              <dd>{{ value }}</dd></template
            >
          </dl>
        </details>
        <div class="row">
          <button @click="suggest('continue')">建议续写</button
          ><button @click="suggest('revise')">建议修改</button
          ><button @click="suggest('direction')">建议方向</button>
        </div>
        <h3>已经留下的篇章</h3>
        <ul class="list">
          <li v-for="item in project.works" :key="item.id">
            <button class="text-button" @click="openWork(item.id)">
              第 {{ item.ordinal }} 篇 · {{ item.title }}</button
            ><small>{{ item.state === "draft" ? "草稿" : "完成稿" }}</small>
          </li>
        </ul>
        <h3 v-if="project.sources.length">接触的资料</h3>
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
      :title="source?.title || '资料'"
      eyebrow="实际返回的摘录"
      width="740px"
      @close="source = null"
      ><template v-if="source"
        ><a :href="source.url" target="_blank" rel="noopener noreferrer"
          >打开来源</a
        >
        <p class="faint">{{ when(source.created, zone) }}</p>
        <p class="work-body">{{ source.content }}</p></template
      ></Sheet
    >
  </div>
</template>
<style scoped src="./TimePage.css"></style>
