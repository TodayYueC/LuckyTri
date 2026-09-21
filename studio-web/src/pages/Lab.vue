<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { studio } from "../store";
import { toast } from "../api";
import { getTrace, listEvents, listTraces, replayRange } from "../plates/live";

const sessionId = ref("");
const events = ref<any[]>([]);
const traces = ref<any[]>([]);
const from = ref("");
const to = ref("");
const detail = ref(
  "选择一条日志查看最终上下文、Prompt、原始输出、Token 与耗时。",
);
let timer: ReturnType<typeof setInterval>;

onMounted(() => {
  sessionId.value = studio.core.sessions[0]?.id || "";
  load();
  timer = setInterval(load, 2000);
});
onUnmounted(() => clearInterval(timer));

async function load() {
  if (!sessionId.value) return;
  events.value = await listEvents(sessionId.value);
  traces.value = await listTraces(sessionId.value);
  if (events.value.length) {
    from.value = String(events.value.at(-1).seq);
    to.value = String(events.value[0].seq);
  }
}

async function replay() {
  toast("回放正在运行");
  const result = await replayRange({
    session: sessionId.value,
    from: Number(from.value),
    to: Number(to.value),
  });
  detail.value = JSON.stringify(result, null, 2);
  toast("回放结束");
  traces.value = await listTraces("");
}

async function openTrace(id: string) {
  detail.value = JSON.stringify(await getTrace(id), null, 2);
}
</script>

<template>
  <section class="panel">
    <h2>历史消息与回放</h2>
    <div class="row">
      <select id="debugSession" v-model="sessionId" @change="load">
        <option v-for="s in studio.core.sessions" :key="s.id" :value="s.id">
          {{ s.name }}
        </option>
      </select>
      <button id="loadMessages" @click="load">加载消息</button>
    </div>
    <div class="grid">
      <label>起始序号<input name="from" type="number" v-model="from" /></label>
      <label>截止序号<input name="to" type="number" v-model="to" /></label>
    </div>
    <button id="replay" @click="replay">隔离回放这批消息</button>
    <p class="small">
      使用当前模型重新理解这段历史消息。结果仅供测试，不发送到
      QQ，也不会修改真实记忆。
    </p>
    <div id="events" class="scroll">
      <table v-if="events.length">
        <tr>
          <th>序号</th>
          <th>发送者</th>
          <th>消息</th>
        </tr>
        <tr v-for="r in events" :key="r.seq">
          <td>{{ r.seq }}</td>
          <td>{{ r.payload.name }}</td>
          <td>{{ r.payload.text }}</td>
        </tr>
      </table>
    </div>
  </section>
  <section class="panel">
    <h2>最近决策</h2>
    <div id="traces">
      <p
        v-for="t in traces"
        :key="t.id"
        :class="{ danger: t.status === 'error' }"
      >
        <button :data-trace="t.id" @click="openTrace(t.id)">
          {{ new Date(t.time).toLocaleTimeString() }} · {{ t.session_id }} ·
          {{ t.mode }} · {{ t.status }}
        </button>
        <br />{{ t.reason || t.error || "" }}
      </p>
    </div>
  </section>
  <section class="panel">
    <h2>运行详情</h2>
    <pre id="traceDetail">{{ detail }}</pre>
  </section>
</template>
