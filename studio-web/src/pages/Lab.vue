<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { studio } from "../store";
import { toast } from "../api";
import { getTrace, listEvents, listTraces, replayRange } from "../plates/live";

const sessionId = ref("");
const events = ref<any[]>([]);
const traces = ref<any[]>([]);
const replayBusy = ref(false);
const selectedTrace = ref<any>(null);
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
  if (events.value.length && !from.value) {
    from.value = String(events.value.at(-1).seq);
    to.value = String(events.value[0].seq);
  }
}

async function replay() {
  if (replayBusy.value) return;
  replayBusy.value = true;
  try {
    toast("回放正在运行");
    const result = await replayRange({
      session: sessionId.value,
      from: Number(from.value),
      to: Number(to.value),
    });
    detail.value = JSON.stringify(result, null, 2);
    toast("回放结束");
    traces.value = await listTraces(sessionId.value);
  } finally {
    replayBusy.value = false;
  }
}

async function openTrace(id: string) {
  selectedTrace.value = await getTrace(id);
  detail.value = JSON.stringify(selectedTrace.value, null, 2);
}
</script>

<template>
  <div class="replay-workbench">
    <section class="replay-source surface">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">REPLAY / SOURCE</span>
          <h2>历史消息</h2>
        </div>
        <button id="loadMessages" @click="load">↻ 加载</button>
      </div>
      <label
        >当前会话<select
          id="debugSession"
          v-model="sessionId"
          @change="
            from = '';
            to = '';
            load();
          "
        >
          <option v-for="s in studio.core.sessions" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select></label
      >
      <div id="events" class="scroll-pane">
        <table v-if="events.length">
          <thead>
            <tr>
              <th>序号</th>
              <th>发送者</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in events" :key="r.seq">
              <td>{{ r.seq }}</td>
              <td>{{ r.payload.name }}</td>
              <td>{{ r.payload.text }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          <span>◷</span>
          <p>当前会话暂无历史消息。</p>
        </div>
      </div>
      <form class="replay-controls" @submit.prevent="replay">
        <div class="grid">
          <label
            >起始序号<input
              name="from"
              type="number"
              v-model="from"
              required /></label
          ><label
            >截止序号<input name="to" type="number" v-model="to" required
          /></label>
        </div>
        <button
          id="replay"
          class="primary"
          :disabled="replayBusy || !events.length"
        >
          {{ replayBusy ? "正在回放…" : "回放这段对话 ↗" }}
        </button>
        <p class="small">只测试回复，不发送 QQ，不修改真实记忆。</p>
      </form>
    </section>
    <section class="replay-traces surface">
      <div class="section-heading">
        <h2>处理记录</h2>
        <span class="eyebrow">TRACE</span>
      </div>
      <div id="traces" class="scroll-pane">
        <button
          v-for="t in traces"
          :key="t.id"
          :data-trace="t.id"
          class="trace-row"
          :class="{ selected: selectedTrace?.id === t.id }"
          @click="openTrace(t.id)"
        >
          <span
            ><time>{{ new Date(t.time).toLocaleTimeString() }}</time
            ><small>{{
              (
                {
                  sent: "已回复",
                  silent: "旁听",
                  running: "处理中",
                  error: "失败",
                  complete: "完成",
                } as any
              )[t.status] || t.status
            }}</small></span
          >
          <p>{{ t.reason || t.error || "查看处理详情" }}</p>
        </button>
        <p v-if="!traces.length" class="empty-copy">
          有新的消息处理记录后会显示在这里。
        </p>
      </div>
    </section>
    <section class="replay-result surface">
      <div class="section-heading">
        <h2>运行详情</h2>
        <span class="eyebrow">INSPECT</span>
      </div>
      <div class="scroll-pane">
        <template v-if="selectedTrace"
          ><div class="trace-metrics">
            <span
              >模式<b>{{
                selectedTrace.mode === "live" ? "真实聊天" : "测试回放"
              }}</b></span
            ><span
              >耗时<b>{{ selectedTrace.data?.elapsed ?? "—" }} ms</b></span
            ><span
              >模型调用<b
                >{{ selectedTrace.data?.calls?.length ?? 0 }} 次</b
              ></span
            >
          </div>
          <p class="notice">
            {{
              selectedTrace.reason ||
              selectedTrace.data?.decision?.reason ||
              "展开下方查看上下文、模型输入与原始输出。"
            }}
          </p></template
        >
        <pre id="traceDetail">{{ detail }}</pre>
      </div>
    </section>
  </div>
</template>
