<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { api, toast } from "../api";
import { studio } from "../store";
const session = ref(""),
  data = ref<any>(null),
  draft = ref<any>(null),
  busy = ref(false),
  dirty = ref(false),
  query = ref(""),
  before = ref<number | null>(null);
let timer: ReturnType<typeof setInterval>;
const kind: Record<string, string> = {
  reflection: "后来想到",
  revision: "重新理解",
  unfinished: "留待以后",
  reconnection: "久别想起",
};
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
  } catch (e) {
    toast((e as Error).message, true);
  }
}
function changed() {
  dirty.value = true;
  studio.dirty = true;
}
async function save() {
  busy.value = true;
  try {
    await api("/time/settings", "PUT", draft.value);
    dirty.value = false;
    studio.dirty = false;
    await load();
    toast("时间设置已保存");
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function reflect() {
  busy.value = true;
  try {
    const r = await api("/time/reflect", "POST", { session: session.value });
    toast(r.reason, r.status === "error");
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function update(n: any, values: any) {
  try {
    await api("/time/notes/" + encodeURIComponent(n.id), "PATCH", values);
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function remove(n: any) {
  if (!confirm("删除这条内部记录？有后续修正的记录只能隐藏。")) return;
  try {
    await api("/time/notes/" + encodeURIComponent(n.id), "DELETE", {});
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
function date(t: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: data.value?.settings.timeZone || "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(t);
}
onMounted(() => {
  session.value = studio.core.sessions[0]?.id || "";
  load();
  timer = setInterval(load, 10000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="time-workbench" v-if="data && draft">
    <section class="time-hero surface">
      <div class="time-orbit" aria-hidden="true"><i></i><span>◷</span></div>
      <div>
        <span class="eyebrow">TIME / BETWEEN CONVERSATIONS</span>
        <h2>让时间留下痕迹。</h2>
        <p>刚才的对话，后来想到的事，与重新相遇。</p>
        <time>{{ data.clock.local }} · {{ data.clock.period }}</time>
      </div>
      <span class="status-tag">{{
        data.busy
          ? "正在独处"
          : data.settings.enabled
            ? "独处已开启"
            : "按需开启独处"
      }}</span>
    </section>
    <div class="time-metrics">
      <article class="surface">
        <small>24 小时调用</small
        ><b>{{ data.usage.calls }} / {{ data.settings.dailyCalls }}</b>
      </article>
      <article class="surface">
        <small>Token 预算占用（含预留）</small
        ><b
          >{{ data.usage.tokens.toLocaleString() }} /
          {{ data.settings.dailyTokens.toLocaleString() }}</b
        >
      </article>
      <article class="surface">
        <small>这段关系的手记</small
        ><b
          >{{ data.count }} <small>条 · {{ data.open }} 个待续</small></b
        >
      </article>
    </div>
    <div class="time-columns">
      <section class="surface time-journal">
        <div class="section-heading">
          <h2>时间手记</h2>
          <span class="eyebrow">AFTERTHOUGHTS</span>
        </div>
        <label
          >当前会话<select
            v-model="session"
            @change="
              before = null;
              load();
            "
          >
            <option v-for="s in studio.core.sessions" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select></label
        >
        <p class="notice" role="status">
          {{ data.reason || "已进入独处窗口，可以留下新的理解"
          }}<br v-if="data.lastInteraction" /><small v-if="data.lastInteraction"
            >上次交流：{{ date(data.lastInteraction) }}</small
          >
        </p>
        <div class="row">
          <input
            v-model="query"
            placeholder="搜索自己的旧想法"
            aria-label="搜索手记"
            @change="
              before = null;
              load();
            "
          /><button
            @click="reflect"
            :disabled="busy || dirty || data.busy || !session"
          >
            {{ busy ? "处理中…" : "现在回想一次" }}
          </button>
        </div>
        <p class="small">
          内部记录是带有不确定性的观察，不是用户事实。默认不发送，也不会自动写入人物记忆。手动回想同样遵守节奏和预算。
        </p>
        <div class="time-scroll">
          <article
            v-for="n in data.notes"
            :key="n.id"
            class="time-note"
            :class="{ muted: n.hidden }"
          >
            <header>
              <span class="pill">{{ kind[n.kind] || n.kind }}</span
              ><time>{{ date(n.created) }}</time>
            </header>
            <p>{{ n.content }}</p>
            <details v-if="n.parent_id">
              <summary>这次重新看待了过去的自己</summary>
              <p>
                {{
                  data.notes.find((old: any) => old.id === n.parent_id)
                    ?.content || "旧记录位于更早的时间线"
                }}
              </p>
              <code>{{ n.parent_id }}</code>
            </details>
            <small
              >来源消息 {{ n.sources.join("、") }} · 置信度
              {{ Math.round(n.confidence * 100) }}% ·
              {{ n.status === "resolved" ? "已放下" : "仍在关注" }}</small
            >
            <p v-if="n.revisit_at" class="small">
              以后再想：{{ date(n.revisit_at) }}
            </p>
            <details v-if="n.outreach">
              <summary>
                可能的问候 ·
                {{
                  n.outreach_status === "sent"
                    ? "已发送"
                    : n.outreach_status === "uncertain"
                      ? "投递未确认，不重发"
                      : "仅草稿"
                }}
              </summary>
              <p>{{ n.outreach }}</p>
            </details>
            <div class="row">
              <button
                @click="
                  update(n, {
                    status: n.status === 'open' ? 'resolved' : 'open',
                  })
                "
              >
                {{ n.status === "open" ? "放下这件事" : "重新关注" }}</button
              ><button @click="update(n, { hidden: !n.hidden })">
                {{ n.hidden ? "恢复参与语境" : "隐藏此记录" }}</button
              ><button class="text-button" @click="remove(n)">删除</button>
            </div>
          </article>
          <div v-if="!data.notes.length" class="empty-state">
            <span>◌</span>
            <h3>还没有留下手记</h3>
            <p>选择允许独处的会话。重要聊天结束后，新的理解才值得被写下来。</p>
          </div>
        </div>
        <div class="row">
          <button
            :disabled="!before"
            @click="
              before = null;
              load();
            "
          >
            回到最近</button
          ><button
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
      <aside class="time-side">
        <section class="surface time-topics">
          <div class="section-heading">
            <h2>慢慢降温的话题</h2>
            <span>◌</span>
          </div>
          <div class="time-scroll small-scroll">
            <article v-for="t in data.topics" :key="t.topic" class="time-topic">
              <b>{{ t.topic }}</b
              ><small>{{ t.distance }}</small
              ><meter :value="t.weight" min="0" max="1">{{ t.weight }}</meter>
            </article>
            <p class="small" v-if="!data.topics.length">
              聊过的话题会出现在这里。时间越久，延续它的必要性越低。
            </p>
          </div>
        </section>
        <form
          class="surface"
          @submit.prevent="save"
          @input="changed"
          @change="changed"
        >
          <div class="section-heading">
            <h2>独处的节奏</h2>
            <span class="eyebrow">RHYTHM</span>
          </div>
          <label class="check"
            ><input
              type="checkbox"
              v-model="draft.enabled"
            />允许低频后台回想</label
          >
          <label
            >时区<input v-model="draft.timeZone" placeholder="Asia/Shanghai"
          /></label>
          <label
            >独处模型<select v-model="draft.modelId">
              <option value="">跟随每个会话</option>
              <option v-for="m in studio.core.models" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
            </select></label
          >
          <fieldset>
            <legend>允许记录的会话</legend>
            <label class="check" v-for="s in studio.core.sessions" :key="s.id"
              ><input
                type="checkbox"
                :value="s.id"
                v-model="draft.sessions"
              />{{ s.name }}</label
            >
          </fieldset>
          <div class="grid">
            <label
              >安静多久再想（分钟）<input
                type="number"
                min="5"
                max="1440"
                v-model.number="draft.idleMinutes" /></label
            ><label
              >两次独处间隔（分钟）<input
                type="number"
                min="30"
                max="10080"
                v-model.number="draft.intervalMinutes" /></label
            ><label
              >普通聊天积累条数<input
                type="number"
                min="3"
                max="100"
                v-model.number="draft.minMessages" /></label
            ><label
              >每天最多调用<input
                type="number"
                min="1"
                max="24"
                v-model.number="draft.dailyCalls"
            /></label>
          </div>
          <details>
            <summary>预算与休息时段</summary>
            <div class="grid">
              <label
                >24小时 Token 上限<input
                  type="number"
                  v-model.number="draft.dailyTokens" /></label
              ><label
                >单次输入预算<input
                  type="number"
                  v-model.number="draft.inputTokens" /></label
              ><label
                >单次输出预算<input
                  type="number"
                  v-model.number="draft.outputTokens" /></label
              ><label
                >休息开始（小时）<input
                  type="number"
                  min="0"
                  max="23"
                  v-model.number="draft.quietStart" /></label
              ><label
                >休息结束（小时）<input
                  type="number"
                  min="0"
                  max="23"
                  v-model.number="draft.quietEnd"
              /></label>
            </div>
            <p class="small">
              开始和结束相同表示不设休息时段。预算保守预留，模型失败也占用次数，避免自动重试消耗。
            </p>
          </details>
          <details>
            <summary>克制的主动交流</summary>
            <label class="check"
              ><input
                type="checkbox"
                v-model="draft.proactive"
              />允许向所选会话发送主动问候</label
            ><label
              >至少多久没交流（小时）<input
                type="number"
                min="6"
                max="720"
                v-model.number="draft.proactiveHours"
            /></label>
            <p class="small">
              每个会话每天至多一次；休息、暂停、模拟、离线时不发送。上次消息无人回应时不会追发。只发送通过人格与重复检查的短句。
            </p>
          </details>
          <button class="primary" :disabled="busy">
            {{ busy ? "保存中…" : "保存时间设置 ↗" }}
          </button>
        </form>
      </aside>
    </div>
    <section class="surface">
      <div class="section-heading">
        <h2>时间经过的记录</h2>
        <span class="eyebrow">ACTIVITY</span>
      </div>
      <div class="time-scroll small-scroll">
        <article class="time-run" v-for="r in data.runs" :key="r.id">
          <time>{{ date(r.started) }}</time
          ><b>{{
            (
              {
                written: "已留手记",
                empty: "没有新理解",
                error: "未完成",
                cancelled: "已取消",
                interrupted: "重启中断",
                running: "回想中",
              } as any
            )[r.status] || r.status
          }}</b
          ><span>{{ r.reason }}</span
          ><small>{{ r.model || "模型处理中" }} · {{ r.tokens }} tokens</small>
        </article>
        <p class="small" v-if="!data.runs.length">
          这里会说明何时回想、是否留下内容、用了多少
          Token。安静本身无需写一条日志。
        </p>
      </div>
    </section>
  </div>
  <div v-else class="empty-state" role="status">正在打开时间手记…</div>
</template>

<style scoped>
:global(.page-time) {
  overflow: auto;
  overscroll-behavior: contain;
}
.time-workbench .surface {
  padding: 24px;
}
.time-workbench {
  display: grid;
  gap: 24px;
}
.time-hero {
  display: flex;
  align-items: center;
  gap: 28px;
  position: relative;
  overflow: hidden;
  background: linear-gradient(115deg, #dff8e9, #f5fcf8 65%);
  min-height: 200px;
}
.time-hero h2 {
  font-size: clamp(26px, 3vw, 44px);
  margin: 10px 0;
}
.time-hero p {
  color: #527465;
}
.time-hero > .status-tag {
  margin-left: auto;
}
.time-orbit {
  width: 110px;
  height: 110px;
  flex: none;
  border: 1px solid #86bba2;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
}
.time-orbit span {
  font-size: 58px;
  color: #36775a;
}
.time-orbit i {
  position: absolute;
  inset: -10px;
  border: 1px dashed #86bba2;
  border-radius: 50%;
  animation: time-orbit 40s linear infinite;
}
.time-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.time-metrics article {
  display: grid;
  gap: 12px;
}
.time-metrics b {
  font-size: 24px;
}
.time-metrics small {
  font-size: 13px;
  color: #547263;
}
.time-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr);
  gap: 24px;
  align-items: start;
}
.time-side {
  display: grid;
  gap: 24px;
  min-width: 0;
  min-height: 0;
  align-content: start;
}
.time-side form {
  display: grid;
  gap: 18px;
  min-width: 0;
  min-height: 0;
}
.time-scroll {
  max-height: 720px;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 8px;
}
.small-scroll {
  max-height: 240px;
}
.time-topics {
  min-height: 0;
  overflow: hidden;
}
.time-topics .small-scroll {
  height: 220px;
  max-height: 220px;
  min-height: 0;
  overflow-y: auto;
}
.time-journal {
  min-width: 0;
}
.time-note {
  padding: 24px 0;
  border-bottom: 1px solid #d6e7de;
  overflow-wrap: anywhere;
}
.time-note header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.time-note p {
  line-height: 1.85;
  white-space: pre-wrap;
}
.time-note time,
.time-note small {
  font-size: 12px;
  color: #60786b;
}
.time-note .row {
  margin-top: 15px;
}
.time-note.muted {
  opacity: 0.55;
}
.time-topic {
  display: grid;
  gap: 7px;
  padding: 12px 0;
}
.time-topic meter {
  width: 100%;
  accent-color: #5ca681;
}
.time-topic small {
  color: #637b6c;
}
.time-run {
  display: grid;
  grid-template-columns: 160px 90px 1fr;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid #d6e7de;
}
.time-run small {
  grid-column: 3;
}
.time-journal > .row {
  margin: 16px 0;
}
.time-journal > .row input {
  min-width: 0;
  flex: 1;
}
.time-side fieldset {
  max-height: 180px;
  overflow: auto;
  border: 1px solid #d6e7de;
}
.time-side details .grid {
  margin-top: 16px;
}
.time-note code {
  overflow-wrap: anywhere;
}
@keyframes time-orbit {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1050px) {
  .time-columns {
    grid-template-columns: 1fr;
  }
  .time-hero > .status-tag {
    display: none;
  }
}
@media (max-width: 600px) {
  .time-metrics {
    grid-template-columns: 1fr;
  }
  .time-hero {
    gap: 16px;
  }
  .time-orbit {
    width: 60px;
    height: 60px;
  }
  .time-orbit span {
    font-size: 36px;
  }
  .time-run {
    grid-template-columns: 1fr;
  }
  .time-run small {
    grid-column: 1;
  }
  .time-journal > .row {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .time-orbit i {
    animation: none;
  }
}
:global(.quiet-motion) .time-orbit i {
  animation: none;
}
</style>
