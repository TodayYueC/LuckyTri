<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, toast } from "../api";
import { studio } from "../store";

const session = ref("");
const data = ref<any>(null);
const draft = ref<any>(null);
const busy = ref(false);
const dirty = ref(false);
const query = ref("");
const before = ref<number | null>(null);
const view = ref<"now" | "journal" | "self" | "settings" | "activity">("now");
let timer: ReturnType<typeof setInterval>;

const views = [
  { id: "now", label: "此刻", en: "NOW" },
  { id: "journal", label: "时间手记", en: "JOURNAL" },
  { id: "self", label: "自己的线索", en: "OWN THREADS" },
  { id: "settings", label: "独处方式", en: "RHYTHM" },
  { id: "activity", label: "运行记录", en: "ACTIVITY" },
] as const;
const kind: Record<string, string> = {
  reflection: "后来想到",
  revision: "重新理解",
  unfinished: "仍放在心上",
  reconnection: "久别想起",
};
const threadKind: Record<string, string> = {
  curiosity: "好奇",
  care: "放在心上",
  stance: "自己的看法",
  intention: "想做的事",
};
const energy: Record<string, string> = {
  low: "慢一点",
  steady: "平稳",
  bright: "有精神",
};
const socialPull: Record<string, string> = {
  settled: "安静待着",
  open: "愿意聊聊",
  reconnect: "想起了对方",
};
const selectedSession = computed(() =>
  studio.core.sessions.find((item: any) => item.id === session.value),
);
const allSelected = computed(
  () =>
    !!draft.value?.sessions?.length &&
    draft.value.sessions.length === studio.core.sessions.length,
);

async function load() {
  try {
    const selected = session.value;
    const result = await api(
      "/time?session=" +
        encodeURIComponent(selected) +
        "&q=" +
        encodeURIComponent(query.value) +
        (before.value ? "&before=" + before.value : ""),
    );
    if (selected !== session.value) return;
    data.value = result;
    if (!dirty.value) draft.value = structuredClone(result.settings);
  } catch (error) {
    toast((error as Error).message, true);
  }
}
function changed() {
  dirty.value = true;
  studio.dirty = true;
}
function switchView(next: typeof view.value) {
  view.value = next;
  window.scrollTo({ top: 0, behavior: "smooth" });
  document
    .querySelector(".page-time")
    ?.scrollTo({ top: 0, behavior: "smooth" });
}
function toggleEnabled() {
  draft.value.enabled = !draft.value.enabled;
  changed();
}
function toggleAllSessions() {
  draft.value.sessions = allSelected.value
    ? []
    : studio.core.sessions.map((item: any) => item.id);
  changed();
}
function preset(name: "natural" | "active" | "quiet") {
  Object.assign(
    draft.value,
    {
      natural: { idleMinutes: 20, intervalMinutes: 60, minMessages: 4 },
      active: { idleMinutes: 8, intervalMinutes: 20, minMessages: 2 },
      quiet: { idleMinutes: 60, intervalMinutes: 360, minMessages: 12 },
    }[name],
  );
  changed();
}
async function save() {
  busy.value = true;
  try {
    await api("/time/settings", "PUT", draft.value);
    dirty.value = false;
    studio.dirty = false;
    await load();
    toast("时间设置已保存");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function reflect() {
  busy.value = true;
  try {
    const result = await api("/time/reflect", "POST", {
      session: session.value,
    });
    toast(result.reason, result.status === "error");
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function update(note: any, values: any) {
  try {
    await api("/time/notes/" + encodeURIComponent(note.id), "PATCH", values);
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function remove(note: any) {
  if (!confirm("删除这条内部记录？有后续修正的记录只能隐藏。")) return;
  try {
    await api("/time/notes/" + encodeURIComponent(note.id), "DELETE", {});
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function updateThread(thread: any, values: any) {
  try {
    await api("/time/threads/" + encodeURIComponent(thread.id), "PATCH", values);
    await load();
    toast("自己的线索已更新");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
function date(value: number | null) {
  if (!value) return "还没有";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: data.value?.settings.timeZone || "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(
    Number(value || 0),
  );
}
function allowance(value: number, suffix = "") {
  return Number(value) === 0
    ? "不限"
    : `${Number(value).toLocaleString()}${suffix}`;
}

onMounted(() => {
  session.value = studio.core.sessions[0]?.id || "";
  load();
  timer = setInterval(load, 10000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div v-if="data && draft" class="time-studio">
    <header class="time-masthead surface">
      <div class="time-art" aria-hidden="true">
        <i></i><i></i><span>{{ data.clock.hour }}</span
        ><small>时</small>
      </div>
      <div class="time-intro">
        <span class="eyebrow">A LIFE BETWEEN CONVERSATIONS</span>
        <h2>时间不是等待，<br /><em>是留下来的自己。</em></h2>
        <p>{{ data.clock.local }} · {{ data.clock.period }}</p>
      </div>
      <div class="time-control">
        <label>
          正在查看
          <select
            v-model="session"
            @change="
              before = null;
              load();
            "
          >
            <option
              v-for="item in studio.core.sessions"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="life-switch"
          :class="{ on: draft.enabled }"
          :aria-pressed="draft.enabled"
          @click="toggleEnabled"
        >
          <span><i></i></span>
          <b>{{
            data.busy
              ? "正在独处"
              : draft.enabled
                ? "独处已开启"
                : "独处尚未开启"
          }}</b>
          <small>{{ dirty ? "保存后生效" : data.reason || "状态正常" }}</small>
        </button>
      </div>
    </header>

    <nav class="time-local-nav surface" aria-label="时间页面分区">
      <button
        v-for="item in views"
        :key="item.id"
        type="button"
        :class="{ active: view === item.id }"
        @click="switchView(item.id)"
      >
        <small>{{ item.en }}</small
        ><b>{{ item.label }}</b
        ><span>↗</span>
      </button>
    </nav>

    <div v-if="dirty" class="time-savebar" role="status">
      <span>时间设置有修改，保存后才会开始按新节奏生活。</span>
      <button type="button" @click="save" :disabled="busy">
        {{ busy ? "保存中…" : "保存设置" }}
      </button>
    </div>

    <template v-if="view === 'now'">
      <section class="inner-layout">
        <article class="inner-card surface">
          <div class="inner-sky" aria-hidden="true">
            <span></span><i></i><i></i><b>◌</b>
          </div>
          <div class="inner-copy">
            <span class="eyebrow">INNER WEATHER / 此刻的内在天气</span>
            <h3>{{ data.inner.label }}</h3>
            <p class="inner-narrative">{{ data.inner.narrative }}</p>
            <div class="state-chips">
              <span>情绪色彩 · {{ data.inner.mood }}</span>
              <span
                >能量 ·
                {{ energy[data.inner.energy] || data.inner.energy }}</span
              >
              <span
                >靠近倾向 ·
                {{
                  socialPull[data.inner.socialPull] || data.inner.socialPull
                }}</span
              >
            </div>
          </div>
        </article>

        <aside class="attention-card surface">
          <span class="eyebrow">ATTENTION</span>
          <h3>现在放在心上的事</h3>
          <p>{{ data.inner.attention }}</p>
          <dl>
            <div>
              <dt>上次交流</dt>
              <dd>{{ date(data.inner.lastInteraction) }}</dd>
            </div>
            <div>
              <dt>状态更新</dt>
              <dd>{{ date(data.inner.updated) }}</dd>
            </div>
            <div>
              <dt>待续想法</dt>
              <dd>{{ data.inner.openThoughts }} 件</dd>
            </div>
            <div>
              <dt>近七天消息</dt>
              <dd>{{ data.inner.recentMessages }} 条</dd>
            </div>
          </dl>
          <button
            type="button"
            class="primary reflect-now"
            :disabled="busy || dirty || data.busy || !session"
            @click="reflect"
          >
            {{ busy || data.busy ? "正在想…" : "现在独处一会儿" }}
          </button>
          <small>{{ data.reason || "现在适合重新看看最近发生的事" }}</small>
        </aside>
      </section>

      <section class="now-grid">
        <article class="surface topic-room">
          <div class="section-heading">
            <div>
              <span class="eyebrow">FADING TOPICS</span>
              <h3>话题正在怎样降温</h3>
            </div>
            <span>{{ data.topics.length }} 条</span>
          </div>
          <div v-if="data.topics.length" class="topic-list">
            <div
              v-for="topic in data.topics"
              :key="topic.topic"
              class="topic-row"
            >
              <div>
                <b>{{ topic.topic }}</b
                ><small>{{ topic.distance }}</small>
              </div>
              <div class="topic-meter">
                <i :style="{ width: `${Math.round(topic.weight * 100)}%` }"></i>
              </div>
              <em>{{ Math.round(topic.weight * 100) }}%</em>
            </div>
          </div>
          <div v-else class="gentle-empty">
            <b>暂时没有需要抓住的话题</b>
            <p>
              普通闲聊会自然淡下去；重要、反复出现或仍未结束的事会留得更久。
            </p>
          </div>
        </article>

        <article class="surface state-trail">
          <div class="section-heading">
            <div>
              <span class="eyebrow">CHANGING SELF</span>
              <h3>过去的自己怎么看</h3>
            </div>
            <button
              type="button"
              class="text-button"
              @click="switchView('journal')"
            >
              看全部 ↗
            </button>
          </div>
          <div v-if="data.states.length > 1" class="state-list">
            <div v-for="state in data.states.slice(1, 5)" :key="state.id">
              <time>{{ date(state.created) }}</time>
              <b
                >{{ state.mood }} ·
                {{ energy[state.energy] || state.energy }}</b
              >
              <p>{{ state.narrative }}</p>
            </div>
          </div>
          <div v-else class="gentle-empty">
            <b>还没有“过去的自己”可以回看</b>
            <p>至少经历两次不同的独处，这里才会显示变化；当前状态在上方。</p>
          </div>
        </article>
      </section>

      <section class="surface own-preview">
        <div class="section-heading">
          <div>
            <span class="eyebrow">OWN THREADS</span>
            <h3>她选择继续想的事</h3>
          </div>
          <button type="button" @click="switchView('self')">看线索 ↗</button>
        </div>
        <p class="own-intro">这些不是对群友的定论，而是有来源、将来可以改变的关注和想法。</p>
        <div v-if="data.ownThreads.length" class="own-preview-grid">
          <article v-for="thread in data.ownThreads.slice(0, 3)" :key="thread.id">
            <small>{{ threadKind[thread.kind] || thread.kind }} · {{ thread.origin === 'self' ? '自己的兴趣' : '来自聊天' }}</small>
            <p>{{ thread.content }}</p>
            <span v-if="thread.next_action">以后 · {{ thread.next_action }}</span>
          </article>
        </div>
        <div v-else class="gentle-empty">
          <b>还没有自己的线索</b>
          <p>有值得再想的事情时才留下，不为了展示“有心”而制造想法。</p>
        </div>
      </section>

      <section class="surface recent-thoughts">
        <div class="section-heading">
          <div>
            <span class="eyebrow">RECENT THOUGHTS</span>
            <h3>最近留下的内心记录</h3>
          </div>
          <button type="button" @click="switchView('journal')">
            进入时间手记 ↗
          </button>
        </div>
        <div v-if="data.notes.length" class="thought-preview">
          <article v-for="note in data.notes.slice(0, 3)" :key="note.id">
            <span>{{ kind[note.kind] || note.kind }}</span>
            <p>{{ note.content }}</p>
            <time>{{ date(note.created) }}</time>
          </article>
        </div>
        <div v-else class="gentle-empty">
          <b>还没有写下什么</b>
          <p>开启独处并选择会话后，它会在聊天安静下来时重新理解发生过的事。</p>
        </div>
      </section>
    </template>

    <section v-else-if="view === 'journal'" class="journal-page surface">
      <details v-if="data.states.length" class="state-history">
        <summary>自己的变化 · 最近 {{ data.states.length }} 次</summary>
        <div class="state-list">
          <article v-for="state in data.states" :key="state.id">
            <time>{{ date(state.created) }}</time>
            <h4>
              {{ state.mood }} ·
              {{ socialPull[state.social_pull] || "安静待着" }}
            </h4>
            <p>{{ state.narrative }}</p>
            <small>当时关注：{{ state.attention }}</small>
          </article>
        </div>
      </details>
      <div class="journal-heading">
        <div>
          <span class="eyebrow">PRIVATE JOURNAL</span>
          <h3>{{ selectedSession?.name || "这段关系" }}的时间手记</h3>
          <p>
            记录“后来是怎么想的”。旧想法不会被覆盖，新的理解会沿着它继续生长。
          </p>
        </div>
        <div class="journal-tools">
          <input
            v-model="query"
            aria-label="搜索时间手记"
            placeholder="搜索某件事、某个人或一种感受"
            @change="
              before = null;
              load();
            "
          />
          <button
            type="button"
            @click="reflect"
            :disabled="busy || dirty || data.busy || !session"
          >
            {{ busy ? "正在想…" : "现在回想一次" }}
          </button>
        </div>
      </div>

      <div v-if="data.notes.length" class="journal-list">
        <article
          v-for="(note, index) in data.notes"
          :key="note.id"
          class="time-note"
          :class="{ muted: note.hidden }"
        >
          <div class="note-index">{{ String(index + 1).padStart(2, "0") }}</div>
          <div class="note-body">
            <header>
              <span class="note-kind">{{ kind[note.kind] || note.kind }}</span>
              <time>{{ date(note.created) }}</time>
            </header>
            <p>{{ note.content }}</p>
            <div class="note-meta">
              <span>置信度 {{ Math.round(note.confidence * 100) }}%</span>
              <span>{{
                note.status === "resolved" ? "已经放下" : "仍在关注"
              }}</span>
              <span v-if="note.revisit_at"
                >以后再看 · {{ date(note.revisit_at) }}</span
              >
            </div>
            <div v-if="note.parent_id" class="revision-link">
              <b>↳ 这是对过去想法的修正</b>
              <p>
                {{
                  data.notes.find((old: any) => old.id === note.parent_id)
                    ?.content || "旧记录在更早的时间线里"
                }}
              </p>
            </div>
            <div v-if="note.outreach" class="outreach-draft">
              <small>曾经想说</small>
              <p>{{ note.outreach }}</p>
              <span>{{
                note.outreach_status === "sent"
                  ? "已发出"
                  : note.outreach_status === "uncertain"
                    ? "投递未确认"
                    : "留在草稿里"
              }}</span>
            </div>
            <footer>
              <button
                type="button"
                @click="
                  update(note, {
                    status: note.status === 'open' ? 'resolved' : 'open',
                  })
                "
              >
                {{ note.status === "open" ? "放下这件事" : "重新关注" }}
              </button>
              <button
                type="button"
                @click="update(note, { hidden: !note.hidden })"
              >
                {{ note.hidden ? "恢复参与语境" : "不再参与语境" }}
              </button>
              <button type="button" class="text-button" @click="remove(note)">
                删除
              </button>
            </footer>
          </div>
        </article>
      </div>
      <div v-else class="journal-empty">
        <span>◌</span>
        <h3>这页还没有字</h3>
        <p>内部记录只在有新的理解时出现，不会为了显得忙碌而写流水账。</p>
      </div>
      <div class="journal-pagination">
        <button
          type="button"
          :disabled="!before"
          @click="
            before = null;
            load();
          "
        >
          回到最近
        </button>
        <span>本页 {{ data.notes.length }} 条 · 共 {{ data.count }} 条</span>
        <button
          type="button"
          :disabled="data.notes.length < 30"
          @click="
            before = data.notes.at(-1).created;
            load();
          "
        >
          更早的自己 ↗
        </button>
      </div>
    </section>

    <section v-else-if="view === 'self'" class="self-page surface">
      <div class="journal-heading">
        <div>
          <span class="eyebrow">A THREAD OF HER OWN</span>
          <h3>自己的线索</h3>
          <p>她可以有自己的好奇、看法和想做的事。旧想法不会被悄悄改写，新的经历会留下修正或放下的痕迹。</p>
        </div>
      </div>
      <div class="self-columns">
        <div>
          <h4>仍在继续 · {{ data.ownThreads.length }}</h4>
          <div v-if="data.ownThreads.length" class="self-thread-list">
            <article v-for="thread in data.ownThreads" :key="thread.id" class="self-thread">
              <header><span>{{ threadKind[thread.kind] || thread.kind }} · {{ thread.origin === 'self' ? '自己的兴趣' : '来自聊天' }}</span><time>{{ date(thread.created) }}</time></header>
              <p>{{ thread.content }}</p>
              <small v-if="thread.next_action">下次想怎么对待它 · {{ thread.next_action }}</small>
              <footer>
                <span>把握度 {{ Math.round(thread.confidence * 100) }}%</span>
                <button type="button" @click="updateThread(thread, { status: 'closed' })">暂时放下</button>
                <button type="button" @click="updateThread(thread, { hidden: true })">不再带入聊天</button>
              </footer>
            </article>
          </div>
          <div v-else class="gentle-empty"><b>现在没有非得坚持的想法</b><p>这也是一种状态。她会在有新的经历时再决定什么值得留下。</p></div>
        </div>
        <div>
          <h4>形成与改变的轨迹</h4>
          <div v-if="data.threadHistory.length" class="self-thread-list history">
            <article v-for="thread in data.threadHistory" :key="thread.id" class="self-thread">
              <header><span>{{ threadKind[thread.kind] || thread.kind }} · {{ thread.status === 'closed' ? '已放下' : thread.parent_id ? '后来修正' : '最初写下' }}</span><time>{{ date(thread.created) }}</time></header>
              <p>{{ thread.content }}</p>
              <small v-if="thread.parent_id">↳ 接续之前的想法</small>
              <footer v-if="thread.hidden || (thread.status === 'closed' && !data.threadHistory.some((item: any) => item.parent_id === thread.id))">
                <button v-if="thread.hidden" type="button" @click="updateThread(thread, { hidden: false })">恢复带入聊天</button>
                <button v-if="thread.status === 'closed' && !data.threadHistory.some((item: any) => item.parent_id === thread.id)" type="button" @click="updateThread(thread, { status: 'active' })">重新关注</button>
              </footer>
            </article>
          </div>
          <div v-else class="gentle-empty"><b>还没有变化轨迹</b><p>第一次留下想法后，这里会保存它如何形成、如何被修正。</p></div>
        </div>
      </div>
    </section>

    <form
      v-else-if="view === 'settings'"
      class="settings-page"
      @submit.prevent="save"
      @input="changed"
      @change="changed"
    >
      <section class="settings-lead surface">
        <div>
          <span class="eyebrow">HOW TIME FLOWS</span>
          <h3>决定她怎样度过没人说话的时间</h3>
          <p>
            默认采用自然节奏。所有数量限制都可以自由填写；调用次数、Token
            和模型输入输出填 0 代表不限或直接跟随模型。
          </p>
        </div>
        <div class="preset-row">
          <button type="button" @click="preset('natural')">自然</button>
          <button type="button" @click="preset('active')">更爱琢磨</button>
          <button type="button" @click="preset('quiet')">更安静</button>
        </div>
      </section>

      <div class="settings-grid">
        <section class="surface setting-card behavior-card">
          <span class="setting-number">01</span>
          <div class="section-heading">
            <div>
              <span class="eyebrow">BEHAVIOR</span>
              <h3>独处与主动性</h3>
            </div>
          </div>
          <label class="setting-toggle">
            <input type="checkbox" v-model="draft.enabled" />
            <span
              ><b>允许后台独处</b
              ><small>聊天安静下来后，偶尔重新理解近期经历。</small></span
            >
          </label>
          <label class="setting-toggle">
            <input type="checkbox" v-model="draft.phaseReflections" />
            <span
              ><b>让长时间安静产生变化</b
              ><small
                >从余韵、安静、偶尔想起到久别，在阶段变化时重读过去。</small
              ></span
            >
          </label>
          <label
            >无人说话时，多久重新看看旧想法（小时）
            <input type="number" min="0" v-model.number="draft.revisitHours" />
            <small
              >需要开启时间变化。0
              关闭周期回看；可以不写手记，也可以转向共同兴趣。</small
            >
          </label>
          <label
            >两次主动联系至少相隔（小时）
            <input
              type="number"
              min="0"
              v-model.number="draft.proactiveIntervalHours"
            />
            <small>0 不额外限时。上一条主动消息未获回应时仍不追发。</small>
          </label>
          <label class="setting-toggle">
            <input type="checkbox" v-model="draft.proactive" />
            <span
              ><b>允许克制地主动联系</b
              ><small
                >只在有具体上下文时开口，不发送机械问候，也不追问未回复的消息。</small
              ></span
            >
          </label>
          <label
            >最少多久没交流才可能主动（小时）<input
              type="number"
              min="0"
              v-model.number="draft.proactiveHours"
            /><small>0 表示不额外等待，但仍需产生合适的主动内容。</small></label
          >
        </section>

        <section class="surface setting-card scope-card">
          <span class="setting-number">02</span>
          <div class="section-heading">
            <div>
              <span class="eyebrow">RELATIONSHIPS</span>
              <h3>在哪些关系里拥有时间</h3>
            </div>
            <button
              type="button"
              class="text-button"
              @click="toggleAllSessions"
            >
              {{ allSelected ? "全部取消" : "全部选择" }}
            </button>
          </div>
          <div class="session-picks">
            <label
              v-for="item in studio.core.sessions"
              :key="item.id"
              :class="{ selected: draft.sessions.includes(item.id) }"
            >
              <input
                type="checkbox"
                :value="item.id"
                v-model="draft.sessions"
              />
              <span
                ><b>{{ item.name }}</b
                ><small>{{
                  item.kind === "private" ? "私聊" : "群聊"
                }}</small></span
              >
              <i>{{ draft.sessions.includes(item.id) ? "✓" : "+" }}</i>
            </label>
          </div>
        </section>

        <section class="surface setting-card rhythm-card">
          <span class="setting-number">03</span>
          <div class="section-heading">
            <div>
              <span class="eyebrow">RHYTHM</span>
              <h3>思考的节奏</h3>
            </div>
          </div>
          <div class="field-grid">
            <label
              >聊天安静多久再想（分钟）<input
                type="number"
                min="0"
                v-model.number="draft.idleMinutes"
              /><small>从最后一条消息开始计算。</small></label
            >
            <label
              >两次独处至少间隔（分钟）<input
                type="number"
                min="0"
                v-model.number="draft.intervalMinutes"
              /><small>填 0 不设置冷却。</small></label
            >
            <label
              >普通聊天积累多少条<input
                type="number"
                min="0"
                v-model.number="draft.minMessages"
              /><small>填 0 表示有新消息即可判断。</small></label
            >
            <label
              >时区<input
                v-model="draft.timeZone"
                placeholder="Asia/Shanghai"
              /><small>决定早晚、跨日和休息时段。</small></label
            >
          </div>
          <div class="field-grid">
            <label
              >休息开始（0–23 时）<input
                type="number"
                min="0"
                max="23"
                v-model.number="draft.quietStart"
            /></label>
            <label
              >休息结束（0–23 时）<input
                type="number"
                min="0"
                max="23"
                v-model.number="draft.quietEnd"
            /></label>
          </div>
          <p class="setting-note">
            开始和结束相同表示不设置休息时段。休息只暂停后台思考，不影响正常聊天。
          </p>
        </section>

        <section class="surface setting-card resource-card">
          <span class="setting-number">04</span>
          <div class="section-heading">
            <div>
              <span class="eyebrow">MODEL & CAPACITY</span>
              <h3>模型与容量</h3>
            </div>
          </div>
          <label
            >独处使用的模型
            <select v-model="draft.modelId">
              <option value="">跟随每个会话</option>
              <option
                v-for="model in studio.core.models"
                :key="model.id"
                :value="model.id"
              >
                {{ model.label }}
              </option>
            </select>
            <small>跟随会话时，会沿用该会话正在使用的模型能力。</small>
          </label>
          <div class="field-grid capacity-fields">
            <label
              >24 小时调用次数<input
                type="number"
                min="0"
                v-model.number="draft.dailyCalls"
              /><small>0 = 不限</small></label
            >
            <label
              >24 小时 Token<input
                type="number"
                min="0"
                v-model.number="draft.dailyTokens"
              /><small>0 = 不限</small></label
            >
            <label
              >单次最大输入<input
                type="number"
                min="0"
                v-model.number="draft.inputTokens"
              /><small>0 = 跟随模型</small></label
            >
            <label
              >单次最大输出<input
                type="number"
                min="0"
                v-model.number="draft.outputTokens"
              /><small>0 = 跟随模型</small></label
            >
          </div>
          <p class="setting-note">
            这些是你主动设置的护栏，不再使用旧版本的固定上限。即使不限，系统仍会跳过重复内容和没有新理解的反思。
          </p>
        </section>
      </div>
      <div class="settings-submit surface">
        <div>
          <b>当前：{{ draft.enabled ? "允许独处" : "未开启独处" }}</b
          ><small
            >已选择 {{ draft.sessions.length }} 个会话 · 24 小时调用
            {{ data.usage.calls }} 次 /
            {{ compact(data.usage.tokens) }} Token</small
          >
        </div>
        <button class="primary" :disabled="busy">
          {{ busy ? "保存中…" : "保存并应用时间设置 ↗" }}
        </button>
      </div>
    </form>

    <section v-else class="activity-page">
      <div class="activity-metrics">
        <article class="surface">
          <small>24 小时调用</small><b>{{ data.usage.calls }}</b
          ><span>{{ allowance(data.settings.dailyCalls, " 次上限") }}</span>
        </article>
        <article class="surface">
          <small>实际 Token</small><b>{{ compact(data.usage.tokens) }}</b
          ><span>{{ allowance(data.settings.dailyTokens, " 上限") }}</span>
        </article>
        <article class="surface">
          <small>内部记录</small><b>{{ data.count + data.threadHistory.length }}</b
          ><span>{{ data.count }} 篇手记 · {{ data.threadHistory.length }} 条想法</span>
        </article>
      </div>
      <section class="surface run-ledger">
        <div class="section-heading">
          <div>
            <span class="eyebrow">TIME LOG</span>
            <h3>时间经过时，系统做了什么</h3>
          </div>
        </div>
        <div v-if="data.runs.length" class="run-list">
          <article v-for="run in data.runs" :key="run.id">
            <time>{{ date(run.started) }}</time>
            <span class="run-status" :data-status="run.status">{{
              (
                {
                  written: "留下手记",
                  thread: "留下自己的线索",
                  state: "状态变化",
                  empty: "没有新想法",
                  error: "未完成",
                  cancelled: "已取消",
                  interrupted: "重启中断",
                  running: "正在独处",
                } as any
              )[run.status] || run.status
            }}</span>
            <div>
              <b>{{ run.reason }}</b
              ><small
                >{{ run.model || "未调用模型" }} ·
                {{ Number(run.tokens || 0).toLocaleString() }} Token</small
              >
            </div>
          </article>
        </div>
        <div v-else class="gentle-empty">
          <b>时间还没有留下运行记录</b>
          <p>安静本身不会生成日志；只有真正尝试回想时才会记录。</p>
        </div>
      </section>
    </section>
  </div>
  <div v-else class="empty-state" role="status">正在打开时间空间…</div>
</template>

<style scoped>
:global(.studio.time-document) {
  height: auto;
  min-height: 100dvh;
  overflow: visible;
  align-items: start;
}
:global(.time-document .sidebar) {
  position: sticky;
  top: 0;
  height: 100dvh;
}
:global(.studio.time-document main) {
  overflow: visible;
}
:global(.time-document .page-time) {
  flex: none;
  overflow: visible;
  height: auto;
  max-height: none;
}
.time-studio .time-masthead {
  min-height: 150px;
  grid-template-columns: 90px minmax(0, 1fr) minmax(240px, 300px);
  gap: 22px;
}
.time-studio .time-art {
  width: 76px;
  height: 76px;
}
.time-studio .time-art span {
  font-size: 30px;
}
.time-studio .time-intro h2 {
  font-size: clamp(24px, 2.5vw, 36px);
}
.time-studio .state-list > div {
  grid-template-columns: 1fr;
  gap: 6px;
}
.time-studio .session-picks {
  max-height: none;
  overflow: visible;
}
.time-studio .setting-card {
  overflow: visible;
}
.time-studio .time-savebar {
  position: static;
}
.time-studio .inner-card {
  min-height: 280px;
}
@media (max-width: 900px) {
  .time-studio .time-masthead {
    grid-template-columns: 76px 1fr;
  }
  .time-studio .time-control {
    grid-column: 1 / -1;
  }
}
@media (max-width: 650px) {
  :global(.time-document .sidebar) {
    position: relative;
    height: auto;
  }
}
:global(.page-time) {
  overflow: auto;
  overscroll-behavior: contain;
}
.time-studio {
  --time-ink: #103d32;
  --time-deep: #0b4a39;
  --time-green: #4d9f72;
  --time-lime: #b9ec80;
  display: grid;
  gap: 20px;
  padding-bottom: 20px;
  color: var(--time-ink);
}
.time-studio .surface {
  padding: 24px;
}
.time-masthead {
  min-height: 246px;
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr) minmax(260px, 340px);
  align-items: center;
  gap: 34px;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 72% 14%, #b9ec8066 0 3px, transparent 4px),
    linear-gradient(118deg, #dcf6e5, #f8fcf7 66%, #eff8dc);
}
.time-masthead::after {
  content: "";
  position: absolute;
  right: -90px;
  top: -160px;
  width: 380px;
  height: 380px;
  border: 1px solid #73ad8a66;
  border-radius: 50%;
  box-shadow:
    0 0 0 40px #b9ec8017,
    0 0 0 82px #75b99112;
  pointer-events: none;
}
.time-art {
  width: 138px;
  height: 138px;
  border-radius: 50%;
  border: 1px solid #6aab84;
  display: grid;
  place-content: center;
  position: relative;
  z-index: 1;
  background: #f9fff8aa;
}
.time-art::before,
.time-art::after,
.time-art > i {
  content: "";
  position: absolute;
  border-radius: 50%;
  border: 1px dashed #75a98a88;
}
.time-art::before {
  inset: -12px;
  animation: time-spin 36s linear infinite;
}
.time-art::after {
  inset: 15px;
  border-style: solid;
}
.time-art > i:first-child {
  width: 10px;
  height: 10px;
  background: var(--time-lime);
  top: -5px;
  left: 62px;
}
.time-art > i:nth-child(2) {
  inset: -25px;
  border-style: solid;
  border-color: #91c9a244 transparent transparent;
}
.time-art span {
  font:
    700 46px/1 Georgia,
    serif;
  position: relative;
  z-index: 1;
}
.time-art small {
  text-align: center;
  letter-spacing: 5px;
  color: #59816b;
}
.time-intro {
  position: relative;
  z-index: 1;
}
.time-intro h2 {
  margin: 12px 0 16px;
  font-size: clamp(30px, 4vw, 54px);
  line-height: 1.08;
  letter-spacing: -2px;
}
.time-intro h2 em {
  color: #3c8b63;
  font-style: normal;
}
.time-intro p {
  color: #547666;
}
.time-control {
  display: grid;
  gap: 14px;
  position: relative;
  z-index: 2;
}
.time-control label {
  font-size: 12px;
  color: #5c7568;
}
.time-control select {
  margin-top: 7px;
}
.life-switch {
  display: grid;
  grid-template-columns: 52px 1fr;
  text-align: left;
  align-items: center;
  gap: 2px 13px;
  padding: 15px;
  background: #fffdf5cc;
  border-color: #bdcdbb;
}
.life-switch > span {
  grid-row: 1/3;
  width: 48px;
  height: 27px;
  border-radius: 99px;
  padding: 3px;
  background: #b8c6bc;
  transition: 0.25s ease;
}
.life-switch > span i {
  display: block;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: white;
  transition: 0.25s ease;
  box-shadow: 0 2px 8px #1a3c2c33;
}
.life-switch.on > span {
  background: var(--time-green);
}
.life-switch.on > span i {
  transform: translateX(21px);
}
.life-switch b {
  font-size: 14px;
}
.life-switch small {
  color: #647a6f;
  white-space: normal;
}
.time-local-nav {
  padding: 0 !important;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  position: sticky;
  top: 0;
  z-index: 8;
  box-shadow: 0 8px 24px #16402c0c;
}
.time-local-nav button {
  min-height: 70px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-content: center;
  gap: 2px 8px;
  border: 0;
  border-right: 1px solid #d6e5d9;
  border-radius: 0;
  background: #ffffffed;
  text-align: left;
  padding: 13px 20px;
}
.time-local-nav button:last-child {
  border-right: 0;
}
.time-local-nav button small {
  grid-column: 1;
  font-size: 8px;
  letter-spacing: 1.5px;
  color: #789083;
}
.time-local-nav button b {
  grid-column: 1;
}
.time-local-nav button span {
  grid-column: 2;
  grid-row: 1/3;
  align-self: center;
}
.time-local-nav button.active {
  color: #103e31;
  background: var(--time-lime);
  box-shadow: inset 0 -3px var(--time-deep);
}
.time-savebar {
  position: sticky;
  top: 76px;
  z-index: 7;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 12px 18px;
  color: #f5fff7;
  background: #103f33ef;
  box-shadow: 0 10px 30px #08291d33;
}
.time-savebar button {
  background: var(--time-lime);
  color: #0c3d2f;
}
.inner-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.75fr);
  gap: 20px;
}
.inner-card {
  min-height: 360px;
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.25fr);
  align-items: center;
  gap: 30px;
  overflow: hidden;
  background: linear-gradient(130deg, #0d4c3c, #17634a);
  color: #f4fff7;
}
.inner-sky {
  height: 260px;
  position: relative;
  display: grid;
  place-items: center;
}
.inner-sky::before,
.inner-sky::after {
  content: "";
  position: absolute;
  border-radius: 50%;
}
.inner-sky::before {
  width: 210px;
  height: 210px;
  border: 1px solid #b9ec8080;
  box-shadow:
    0 0 0 28px #b9ec800c,
    0 0 0 58px #b9ec8008;
}
.inner-sky::after {
  width: 102px;
  height: 102px;
  background: radial-gradient(circle at 35% 30%, #efffd4, #9edb79);
  box-shadow: 0 0 45px #c6f38c55;
}
.inner-sky > span {
  position: absolute;
  width: 224px;
  height: 224px;
  border: 1px dashed #c3f09377;
  border-radius: 50%;
  animation: time-spin 44s linear infinite;
}
.inner-sky > i {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #f6ffd0;
}
.inner-sky > i:nth-of-type(1) {
  top: 48px;
  left: 38px;
}
.inner-sky > i:nth-of-type(2) {
  bottom: 56px;
  right: 30px;
  width: 5px;
  height: 5px;
}
.inner-sky b {
  position: relative;
  z-index: 1;
  color: #1c684c;
  font-size: 54px;
  font-weight: 400;
}
.inner-copy {
  position: relative;
  z-index: 1;
}
.inner-copy .eyebrow {
  color: #bde9ca;
}
.inner-copy h3 {
  margin: 14px 0;
  font-size: clamp(30px, 4vw, 52px);
}
.inner-narrative {
  max-width: 650px;
  font-size: 16px;
  line-height: 1.9;
  color: #e4f6e9;
  white-space: pre-wrap;
}
.state-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 25px;
}
.state-chips span {
  border: 1px solid #a8dfb955;
  padding: 7px 10px;
  background: #ffffff0c;
  font-size: 11px;
}
.attention-card {
  display: flex;
  flex-direction: column;
}
.attention-card h3 {
  margin: 10px 0;
  font-size: 23px;
}
.attention-card > p {
  min-height: 58px;
  line-height: 1.7;
}
.attention-card dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: #d8e7dc;
  margin: 18px 0;
}
.attention-card dl div {
  padding: 12px;
  background: #fbfdf9;
}
.attention-card dt {
  color: #6a7f72;
  font-size: 10px;
}
.attention-card dd {
  margin: 5px 0 0;
  font-size: 12px;
}
.reflect-now {
  margin-top: auto;
  width: 100%;
}
.attention-card > small {
  display: block;
  margin-top: 10px;
  line-height: 1.5;
  color: #708277;
}
.now-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.section-heading h3 {
  margin: 4px 0 0;
  font-size: 21px;
}
.topic-list {
  display: grid;
  gap: 6px;
  margin-top: 18px;
}
.topic-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(90px, 0.8fr) 42px;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid #dbe8dd;
}
.topic-row > div:first-child {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.topic-row small {
  color: #718379;
}
.topic-meter {
  height: 7px;
  background: #e4eee6;
  overflow: hidden;
  transform: skewX(-18deg);
}
.topic-meter i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #8fcf70, #3c8f68);
}
.topic-row em {
  font:
    700 11px/1 Arial,
    sans-serif;
  color: #4f7964;
}
.state-list {
  display: grid;
  margin-top: 16px;
}
.state-list > div {
  display: grid;
  grid-template-columns: 125px 145px 1fr;
  gap: 13px;
  padding: 13px 0;
  border-bottom: 1px solid #dbe8dd;
  align-items: start;
}
.state-list time {
  font-size: 10px;
  color: #718379;
}
.state-list b {
  font-size: 12px;
}
.state-list p {
  margin: 0;
  line-height: 1.6;
}
.gentle-empty {
  padding: 30px 0 12px;
  color: #5f786b;
}
.gentle-empty b {
  color: var(--time-ink);
}
.gentle-empty p {
  line-height: 1.7;
}
.thought-preview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-top: 20px;
}
.thought-preview article {
  min-height: 155px;
  padding: 18px;
  background: #f4f9f1;
  border-left: 3px solid #80bd78;
  display: flex;
  flex-direction: column;
}
.thought-preview span {
  font-size: 10px;
  color: #4f7c63;
}
.thought-preview p {
  line-height: 1.7;
}
.thought-preview time {
  margin-top: auto;
  color: #7b8b82;
  font-size: 10px;
}
.own-intro {
  color: #627e6d;
  line-height: 1.7;
  margin: 14px 0 0;
}
.own-preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}
.own-preview-grid article,
.self-thread {
  min-width: 0;
  padding: 18px;
  background: #f4f9f1;
  border-left: 3px solid #80bd78;
}
.own-preview-grid small,
.self-thread header span {
  color: #3b7e5b;
  font-size: 11px;
  letter-spacing: 0.5px;
}
.own-preview-grid p,
.self-thread p {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  line-height: 1.7;
}
.own-preview-grid span,
.self-thread small {
  color: #617569;
  line-height: 1.6;
}
.self-page {
  min-width: 0;
}
.self-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 30px;
  margin-top: 28px;
}
.self-columns h4 {
  font-size: 18px;
  margin: 0 0 16px;
}
.self-thread-list {
  display: grid;
  align-content: start;
  gap: 12px;
}
.self-thread-list.history .self-thread {
  background: #fafcf8;
  border-color: #c8d7c0;
}
.self-thread header,
.self-thread footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.self-thread time,
.self-thread footer span {
  color: #75877b;
  font-size: 11px;
}
.self-thread footer {
  justify-content: flex-start;
  margin-top: 14px;
}
.self-thread footer span {
  margin-right: auto;
}
.journal-page {
  min-width: 0;
}
.journal-heading {
  display: flex;
  justify-content: space-between;
  gap: 30px;
  padding-bottom: 24px;
  border-bottom: 1px solid #d4e4d8;
}
.journal-heading h3 {
  font-size: 28px;
  margin: 8px 0;
}
.journal-heading p {
  color: #65796e;
}
.journal-tools {
  width: min(430px, 42%);
  display: grid;
  gap: 10px;
  align-content: start;
}
.journal-list {
  max-width: 1040px;
  margin: 0 auto;
}
.time-note {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 18px;
  padding: 28px 0;
  border-bottom: 1px solid #d4e4d8;
}
.time-note.muted {
  opacity: 0.5;
}
.note-index {
  font:
    italic 700 36px/1 Georgia,
    serif;
  color: #bbd4c2;
}
.note-body header {
  display: flex;
  justify-content: space-between;
  gap: 15px;
}
.note-kind {
  color: #3b7e5b;
  font-size: 11px;
  letter-spacing: 1px;
}
.note-body header time {
  color: #718379;
  font-size: 11px;
}
.note-body > p {
  font-size: 15px;
  line-height: 1.9;
  white-space: pre-wrap;
}
.note-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.note-meta span {
  padding: 5px 8px;
  background: #edf5e9;
  color: #567161;
  font-size: 10px;
}
.revision-link,
.outreach-draft {
  margin-top: 16px;
  padding: 14px;
  background: #f6f8ef;
  border-left: 2px solid #a5c97d;
}
.revision-link p,
.outreach-draft p {
  margin: 7px 0;
  line-height: 1.7;
}
.outreach-draft span,
.outreach-draft small {
  font-size: 10px;
  color: #6c7f73;
}
.note-body footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.journal-empty {
  text-align: center;
  padding: 90px 20px;
}
.journal-empty span {
  font-size: 60px;
  color: #7cb28b;
}
.journal-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  padding-top: 22px;
}
.journal-pagination span {
  color: #718379;
  font-size: 11px;
}
.settings-page {
  display: grid;
  gap: 20px;
}
.settings-lead {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: end;
  background: linear-gradient(120deg, #e4f6e8, #fff);
}
.settings-lead h3 {
  font-size: 28px;
  margin: 8px 0;
}
.settings-lead p {
  max-width: 760px;
  line-height: 1.7;
}
.preset-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.setting-card {
  display: grid;
  gap: 17px;
  position: relative;
  overflow: hidden;
}
.setting-number {
  position: absolute;
  right: 15px;
  top: 8px;
  font:
    italic 700 58px/1 Georgia,
    serif;
  color: #dcebdc;
  pointer-events: none;
}
.setting-card .section-heading {
  position: relative;
  z-index: 1;
}
.setting-toggle {
  display: grid !important;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: start;
  padding: 14px;
  background: #f5f9f2;
  border: 1px solid #dbe8dc;
}
.setting-toggle input {
  width: auto;
  margin-top: 3px;
}
.setting-toggle span {
  display: grid;
  gap: 5px;
}
.setting-toggle small,
.setting-card label > small {
  color: #6b7f73;
  line-height: 1.5;
}
.session-picks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  max-height: 380px;
  overflow: auto;
  padding-right: 5px;
}
.session-picks label {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 13px;
  border: 1px solid #d7e5da;
  background: #fbfdf9;
  cursor: pointer;
}
.session-picks label.selected {
  border-color: #559a70;
  background: #eaf7e7;
}
.session-picks input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.session-picks span {
  display: grid;
  gap: 4px;
}
.session-picks small {
  color: #718379;
}
.session-picks i {
  font-style: normal;
  font-size: 18px;
  color: #4b8d66;
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.setting-card label {
  display: grid;
  gap: 7px;
  font-size: 12px;
}
.setting-note {
  margin: 0;
  padding: 12px;
  background: #f1f6ec;
  color: #617569;
  font-size: 11px;
  line-height: 1.65;
}
.settings-submit {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  box-shadow: 0 -8px 28px #19402a10;
}
.settings-submit > div {
  display: grid;
  gap: 5px;
}
.settings-submit small {
  color: #6c7f74;
}
.activity-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}
.activity-metrics article {
  display: grid;
  gap: 9px;
}
.activity-metrics small,
.activity-metrics span {
  color: #687e71;
}
.activity-metrics b {
  font-size: 30px;
}
.run-list {
  display: grid;
  margin-top: 18px;
}
.run-list article {
  display: grid;
  grid-template-columns: 155px 105px 1fr;
  gap: 16px;
  align-items: start;
  padding: 16px 0;
  border-bottom: 1px solid #d8e6db;
}
.run-list time {
  font-size: 11px;
  color: #6f8177;
}
.run-status {
  font-size: 10px;
  padding: 5px 8px;
  text-align: center;
  background: #edf5e8;
  color: #416e55;
}
.run-status[data-status="error"] {
  background: #f7e8df;
  color: #8b5139;
}
.run-list article > div {
  display: grid;
  gap: 5px;
}
.run-list small {
  color: #74857b;
}
@keyframes time-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1150px) {
  .time-masthead {
    grid-template-columns: 130px 1fr;
  }
  .time-control {
    grid-column: 1/-1;
    grid-template-columns: 1fr 1fr;
  }
  .inner-layout {
    grid-template-columns: 1fr;
  }
  .attention-card dl {
    grid-template-columns: repeat(4, 1fr);
  }
}
@media (max-width: 900px) {
  .now-grid,
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .thought-preview {
    grid-template-columns: 1fr;
  }
  .own-preview-grid,
  .self-columns {
    grid-template-columns: 1fr;
  }
  .journal-heading {
    display: grid;
  }
  .journal-tools {
    width: 100%;
  }
}
@media (max-width: 650px) {
  .time-studio {
    gap: 14px;
  }
  .time-studio .surface {
    padding: 18px;
  }
  .time-masthead {
    grid-template-columns: 76px 1fr;
    gap: 18px;
    min-height: 0;
  }
  .time-art {
    width: 66px;
    height: 66px;
  }
  .time-art::before {
    inset: -6px;
  }
  .time-art::after,
  .time-art > i {
    display: none;
  }
  .time-art span {
    font-size: 25px;
  }
  .time-intro h2 {
    letter-spacing: -1px;
  }
  .time-control {
    grid-template-columns: 1fr;
  }
  .time-local-nav button {
    min-height: 60px;
    padding: 9px;
  }
  .time-local-nav button small,
  .time-local-nav button span {
    display: none;
  }
  .time-local-nav button b {
    text-align: center;
    font-size: 12px;
  }
  .time-savebar {
    top: 64px;
    font-size: 11px;
  }
  .inner-card {
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .inner-sky {
    height: 180px;
  }
  .inner-sky::before {
    width: 150px;
    height: 150px;
  }
  .inner-sky::after {
    width: 75px;
    height: 75px;
  }
  .inner-sky > span {
    width: 165px;
    height: 165px;
  }
  .attention-card dl {
    grid-template-columns: 1fr 1fr;
  }
  .topic-row {
    grid-template-columns: 1fr 42px;
  }
  .topic-meter {
    grid-column: 1/-1;
    grid-row: 2;
  }
  .state-list > div {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .time-note {
    grid-template-columns: 42px 1fr;
    gap: 10px;
  }
  .note-index {
    font-size: 24px;
  }
  .journal-pagination {
    flex-wrap: wrap;
  }
  .session-picks,
  .field-grid {
    grid-template-columns: 1fr;
  }
  .settings-lead,
  .settings-submit {
    align-items: stretch;
    display: grid;
  }
  .activity-metrics {
    grid-template-columns: 1fr;
  }
  .run-list article {
    grid-template-columns: 1fr;
    gap: 7px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .time-art::before,
  .inner-sky > span {
    animation: none;
  }
}
:global(.quiet-motion) .time-art::before,
:global(.quiet-motion) .inner-sky > span {
  animation: none;
}
</style>
