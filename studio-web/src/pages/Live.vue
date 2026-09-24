<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { studio } from "../store";
import { toast } from "../api";
import { clearSessionContext } from "../plates/sessions";
import {
  getTrace,
  listEvents,
  listTraces,
  sendFeedback,
  simulateTurn,
} from "../plates/live";
import { fetchState } from "../plates/workspace";
import { subscribe } from "../sse";

const sessionId = ref(sessionStorage.activeSession || "");
const events = ref<any[]>([]);
const traces = ref<any[]>([]);
const knowledge = ref<any[]>([]);
const status = ref("请选择会话");
const statusNames: Record<string, string> = {
  sent: "已回复",
  silent: "在旁听",
  running: "正在思考",
  error: "处理失败",
  cancelled: "已取消",
  complete: "已完成",
  interrupted: "已中断",
};
const busy = ref(false);
const simulateText = ref("");
const simulateUser = ref("10001");
const mentioned = ref(true);
const inspector = ref("decisions");
const feedbackPage = ref(0);
const sending = ref(false);
let streamAbort: AbortController | null = null;
let timer: ReturnType<typeof setInterval>;
let loadedKnowledgeTrace = "";
let loadedMessageSeq = 0;
let loadAgain = false;
let forceReload = false;
const replyDecisions = () => decisions().filter((d: any) => d.reply);
let loadedSession = "";
watch(sessionId, () => {
  feedbackPage.value = 0;
});

function sessions() {
  return (studio.core?.sessions || []).filter((s: any) => !s.archived);
}

async function load(force = false) {
  if (!sessionId.value) return;
  if (busy.value) {
    loadAgain = true;
    forceReload ||= force;
    return;
  }
  const requestedSession = sessionId.value;
  const fullReload = force || loadedSession !== requestedSession;
  busy.value = true;
  try {
    const [rows, list] = await Promise.all([
      listEvents(requestedSession, fullReload ? undefined : loadedMessageSeq),
      listTraces(requestedSession, { limit: 30, compact: true }),
    ]);
    if (sessionId.value !== requestedSession) return;
    const pane = document.getElementById("liveMessages");
    const follow =
      loadedSession !== requestedSession ||
      !pane ||
      pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
    if (fullReload) {
      events.value = rows.reverse();
      loadedMessageSeq = 0;
    } else if (rows.length) events.value = [...events.value, ...rows];
    for (const row of rows)
      loadedMessageSeq = Math.max(loadedMessageSeq, Number(row.seq) || 0);
    if (!fullReload && rows.length === 100) loadAgain = true;
    traces.value = list;
    loadedSession = requestedSession;
    await nextTick();
    if (pane && follow) pane.scrollTop = pane.scrollHeight;
    status.value = "实时同步 · " + new Date().toLocaleTimeString();
    const latest = list.find(
      (t: any) => t.status === "sent" || t.status === "silent",
    );
    if (latest && loadedKnowledgeTrace !== latest.id) {
      loadedKnowledgeTrace = latest.id;
      try {
        const detail = await getTrace(latest.id);
        if (sessionId.value === requestedSession)
          knowledge.value = detail.data?.snapshot?.knowledge || [];
      } catch {
        loadedKnowledgeTrace = "";
      }
    } else if (!latest) {
      loadedKnowledgeTrace = "";
      knowledge.value = [];
    }
  } catch (e) {
    status.value = "同步失败：" + (e as Error).message;
  } finally {
    busy.value = false;
    if (sessionId.value !== requestedSession) {
      loadAgain = false;
      void load();
    } else if (loadAgain) {
      const reloadEverything = forceReload;
      loadAgain = false;
      forceReload = false;
      void load(reloadEverything);
    }
  }
}

watch(
  sessionId,
  (id) => {
    streamAbort?.abort();
    sessionStorage.activeSession = id;
    events.value = [];
    traces.value = [];
    knowledge.value = [];
    loadedSession = "";
    loadedMessageSeq = 0;
    loadedKnowledgeTrace = "";
    loadAgain = false;
    forceReload = false;
    load();
    if (!id) return;
    const controller = new AbortController();
    streamAbort = controller;
    let previous = "";
    void subscribe(
      (value) => {
        const messages = Number((value as { messages?: unknown })?.messages);
        if (Number.isSafeInteger(messages) && messages < loadedMessageSeq) {
          loadedSession = "";
          loadedMessageSeq = 0;
          events.value = [];
          loadedKnowledgeTrace = "";
        }
        const next = JSON.stringify(value);
        const changed = previous !== "" && next !== previous;
        previous = next;
        if (changed) void load();
      },
      { session: id, signal: controller.signal, reconnectMs: 1000 },
    );
  },
  { immediate: true },
);
onMounted(() => {
  if (!sessionId.value && sessions()[0]) sessionId.value = sessions()[0].id;
  // Keep a slow safety refresh for dropped events; normal updates use SSE.
  timer = setInterval(() => load(true), 15000);
});
onUnmounted(() => {
  clearInterval(timer);
  streamAbort?.abort();
});

async function clearContext() {
  if (
    !sessionId.value ||
    !confirm("确定清空这个会话的消息上下文吗？长期记忆不会删除。")
  )
    return;
  await clearSessionContext(sessionId.value);
  events.value = [];
  traces.value = [];
  knowledge.value = [];
  loadedSession = "";
  loadedMessageSeq = 0;
  loadedKnowledgeTrace = "";
  await load(true);
}

async function simulate(e: Event) {
  e.preventDefault();
  if (sending.value) return;
  sending.value = true;
  try {
    const r = await simulateTurn({
      sessionId: sessionId.value,
      userId: simulateUser.value,
      text: simulateText.value,
      mentioned: mentioned.value,
    });
    simulateText.value = "";
    toast(r.reason || "已发送");
    studio.health = await fetchState();
    await load();
  } catch (err) {
    toast((err as Error).message);
  } finally {
    sending.value = false;
  }
}

async function feedback(id: number, tag: string) {
  await sendFeedback(id, tag);
  toast("反馈已保存");
  studio.health = await fetchState();
}

watch(inspector, async (value) => {
  if (value === "feedback") {
    try {
      studio.health = await fetchState();
    } catch {
      /* keep the last loaded feedback list */
    }
  }
});

function decisions() {
  return (studio.health?.decisions || []).filter(
    (d: any) => d.session_id === sessionId.value,
  );
}
</script>

<template>
  <div class="conversation-workbench">
    <section class="conversation-pane surface">
      <div class="conversation-toolbar">
        <label
          >当前会话<select id="liveSession" v-model="sessionId">
            <option value="" disabled>选择群聊或私聊</option>
            <option v-for="s in sessions()" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select></label
        >
        <div class="toolbar-end">
          <span id="liveStatus" class="small">{{ status }}</span
          ><button
            id="clearLiveContext"
            :disabled="!sessionId"
            @click="clearContext"
          >
            清空上下文
          </button>
        </div>
      </div>
      <div
        id="liveMessages"
        class="conversation-messages chat-messages scroll-pane"
      >
        <article
          v-for="r in events"
          :key="r.seq"
          class="live-message message"
          :class="{
            outgoing: r.role === 'assistant',
            bot: r.role === 'assistant',
          }"
        >
          <div class="message-meta">
            <b>{{ r.payload.name }}</b
            ><time>{{ new Date(r.time).toLocaleTimeString() }}</time
            ><span v-if="r.payload.simulated" class="status-tag">模拟</span>
          </div>
          <p>{{ r.payload.text }}</p>
        </article>
        <div v-if="!events.length" class="empty-state">
          <span>↗</span>
          <h3>{{ sessionId ? "等待新的消息" : "选择一段对话" }}</h3>
          <p>群聊与私聊消息将在这里实时同步。</p>
        </div>
      </div>
      <div class="pane-foot">
        <span>LIVE FEED / 实时消息</span
        ><span>{{ events.length }} 条已载入</span>
      </div>
    </section>
    <aside class="inspector surface">
      <div class="inspector-title">
        <span class="eyebrow">BEHIND THE WORDS</span>
        <h2>每一次回应背后</h2>
      </div>
      <div class="segment-tabs" aria-label="对话辅助面板">
        <button
          v-for="(label, key) in {
            decisions: '决策',
            feedback: '反馈',
            simulate: '试聊',
          }"
          :key="key"
          :class="{ active: inspector === key }"
          @click="inspector = key"
        >
          {{ label }}
        </button>
      </div>
      <div
        v-show="inspector === 'decisions'"
        class="inspector-content scroll-pane"
      >
        <div id="liveDecisions">
          <article
            v-for="t in traces.slice(0, 20)"
            :key="t.id"
            class="decision-item"
          >
            <div class="row">
              <time>{{ new Date(t.time).toLocaleTimeString() }}</time
              ><span
                class="status-tag"
                :class="{ danger: t.status === 'error' }"
                >{{ statusNames[t.status] || t.status }}</span
              >
            </div>
            <p>
              {{
                t.reason ||
                (t.status === "running" ? "正在理解这段对话…" : "暂无说明")
              }}
            </p>
          </article>
          <p v-if="!traces.length" class="empty-copy">
            有新的互动后，这里会显示开口或旁听的原因。
          </p>
        </div>
        <details class="reference-fold">
          <summary>这次引用的知识 · {{ knowledge.length }}</summary>
          <p v-for="k in knowledge" :key="k.id">
            {{ k.title }}<br />{{ k.text }}
          </p>
          <p v-if="!knowledge.length" class="small">没有引用文档。</p>
        </details>
      </div>
      <div v-show="inspector === 'feedback'" class="feedback-pane">
        <p class="small">针对具体回复评价口吻，帮助调整聊天表现。</p>
        <div id="feedbackList" class="scroll-pane">
          <article
            v-for="d in replyDecisions().slice(
              feedbackPage * 6,
              feedbackPage * 6 + 6,
            )"
            :key="d.id"
            class="feedback-item"
          >
            <time>{{ new Date(d.time).toLocaleTimeString() }}</time>
            <p class="reply-excerpt">{{ d.reply }}</p>
            <label
              >这句回复怎么样？<select
                :data-feedback="d.id"
                :value="d.feedback || ''"
                @change="
                  feedback(d.id, ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="">选择评价</option>
                <option
                  v-for="(label, tag) in studio.health.feedbackLabels"
                  :key="tag"
                  :value="tag"
                >
                  {{ label }}
                </option>
              </select></label
            >
          </article>
          <p v-if="!replyDecisions().length" class="empty-copy">
            还没有可以评价的回复。
          </p>
        </div>
        <div class="pagination">
          <button :disabled="feedbackPage === 0" @click="feedbackPage--">
            ←</button
          ><span
            >{{ feedbackPage + 1 }} /
            {{ Math.max(1, Math.ceil(replyDecisions().length / 6)) }}</span
          ><button
            :disabled="(feedbackPage + 1) * 6 >= replyDecisions().length"
            @click="feedbackPage++"
          >
            →
          </button>
        </div>
      </div>
      <div
        v-show="inspector === 'simulate'"
        class="inspector-content scroll-pane"
      >
        <h3>试着说一句</h3>
        <p class="small">只在 LuckyBot 里模拟，不会向 QQ 发送。</p>
        <form id="simulate" @submit="simulate">
          <label
            >体验用户 ID<input
              name="userId"
              v-model="simulateUser"
              pattern="\d{4,20}"
              required /></label
          ><label
            >消息<textarea
              name="text"
              v-model="simulateText"
              placeholder="今天发生了什么？"
              required
            ></textarea></label
          ><label class="check"
            ><input type="checkbox" v-model="mentioned" />视为 @ / 点名</label
          ><button class="primary" :disabled="sending || !sessionId">
            {{ sending ? "正在回复…" : "发送模拟消息 ↗" }}
          </button>
        </form>
      </div>
    </aside>
  </div>
</template>
