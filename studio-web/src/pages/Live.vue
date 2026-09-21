<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
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

const sessionId = ref(sessionStorage.activeSession || "");
const events = ref<any[]>([]);
const traces = ref<any[]>([]);
const knowledge = ref<any[]>([]);
const status = ref("正在加载消息");
const busy = ref(false);
const simulateText = ref("");
const simulateUser = ref("10001");
const mentioned = ref(true);

function sessions() {
  return (studio.core?.sessions || []).filter((s: any) => !s.archived);
}

async function load() {
  if (!sessionId.value || busy.value) return;
  busy.value = true;
  try {
    const [rows, list] = await Promise.all([
      listEvents(sessionId.value),
      listTraces(sessionId.value),
    ]);
    events.value = rows.reverse();
    traces.value = list;
    status.value = "实时同步 · " + new Date().toLocaleTimeString();
    const latest = list.find(
      (t: any) => t.status === "sent" || t.status === "silent",
    );
    if (latest) {
      try {
        const detail = await getTrace(latest.id);
        knowledge.value = detail.data?.snapshot?.knowledge || [];
      } catch {
        knowledge.value = [];
      }
    }
  } catch (e) {
    status.value = "同步失败：" + (e as Error).message;
  } finally {
    busy.value = false;
  }
}

watch(sessionId, (id) => {
  sessionStorage.activeSession = id;
  load();
});
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  if (!sessionId.value && sessions()[0]) sessionId.value = sessions()[0].id;
  load();
  timer = setInterval(load, 2500);
});
onUnmounted(() => clearInterval(timer));

async function clearContext() {
  if (
    !sessionId.value ||
    !confirm("确定清空这个会话的消息上下文吗？长期记忆不会删除。")
  )
    return;
  await clearSessionContext(sessionId.value);
  await load();
}

async function simulate(e: Event) {
  e.preventDefault();
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
  }
}

async function feedback(id: number, tag: string) {
  await sendFeedback(id, tag);
  studio.health = await fetchState();
}

function decisions() {
  return (studio.health?.decisions || []).filter(
    (d: any) => d.session_id === sessionId.value,
  );
}
</script>

<template>
  <div class="live-layout">
    <section class="panel">
      <div class="row">
        <label
          >群聊 / 私聊
          <select id="liveSession" v-model="sessionId">
            <option v-for="s in sessions()" :key="s.id" :value="s.id">
              {{ s.name }} · {{ s.id }}
            </option>
          </select>
        </label>
        <span class="small" id="liveStatus">{{ status }}</span>
        <button class="secondary" id="clearLiveContext" @click="clearContext">
          清空当前上下文
        </button>
      </div>
      <p class="small">主表面显示消息流。侧栏是本轮决策和引用的知识。</p>
      <div id="liveMessages" class="conversation-messages chat-messages">
        <article
          v-for="r in events"
          :key="r.seq"
          class="live-message message"
          :class="{
            outgoing: r.role === 'assistant',
            bot: r.role === 'assistant',
          }"
        >
          <div class="small">
            {{ r.payload.name }} · {{ new Date(r.time).toLocaleTimeString() }} ·
            #{{ r.seq }}
          </div>
          <p>{{ r.payload.text }}</p>
        </article>
        <p v-if="!events.length" class="small">
          此会话暂无归档消息，收到 QQ 消息后会自动显示。
        </p>
      </div>
    </section>
    <div>
      <section class="panel">
        <h2>为什么回复 / 为什么安静</h2>
        <div id="liveDecisions">
          <p
            v-for="t in traces.slice(0, 12)"
            :key="t.id"
            :class="{ danger: t.status === 'error' }"
          >
            <span class="small"
              >{{ new Date(t.time).toLocaleTimeString() }} ·
              {{ t.status }}</span
            ><br />
            {{ t.reason || (t.status === "running" ? "正在处理" : "暂无说明") }}
          </p>
          <p v-if="!traces.length" class="small">暂无决策</p>
        </div>
        <div
          v-for="d in decisions().filter((x: any) => x.reply)"
          :key="d.id"
          class="row"
        >
          <span class="small">口吻反馈</span>
          <select
            :data-feedback="d.id"
            :value="d.feedback || ''"
            @change="feedback(d.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">无反馈</option>
            <option
              v-for="(label, tag) in studio.health.feedbackLabels"
              :key="tag"
              :value="tag"
            >
              {{ label }}
            </option>
          </select>
        </div>
      </section>
      <section class="panel">
        <h2>本轮引用的知识</h2>
        <p v-for="k in knowledge" :key="k.id" class="small">
          {{ k.title }} · {{ k.whySelected }}<br />{{ k.text }}
        </p>
        <p v-if="!knowledge.length" class="small">本轮没有装入文档片段。</p>
      </section>
      <section class="panel">
        <h2>试聊 / 模拟</h2>
        <form id="simulate" @submit="simulate">
          <label
            >体验用户 QQ<input
              name="userId"
              v-model="simulateUser"
              pattern="\d{4,20}"
              required
          /></label>
          <label
            >消息<textarea
              name="text"
              v-model="simulateText"
              required
            ></textarea>
          </label>
          <label class="check"
            ><input type="checkbox" v-model="mentioned" />视为 @ / 点名</label
          >
          <button class="primary">发送模拟消息</button>
        </form>
      </section>
    </div>
  </div>
</template>
