<script setup lang="ts">
import { ref, watch } from "vue";
import { toast } from "../../api";
import { getTrace, listTraces, replayRange } from "../../plates/live";
import { clockTime, num } from "../../format";
import Sheet from "../../components/ui/Sheet.vue";

const props = defineProps<{
  open: boolean;
  sessionId: string;
  events: any[];
}>();
const emit = defineEmits<{ close: []; load: [] }>();

const STATUS: Record<string, string> = {
  sent: "开口了",
  silent: "没出声",
  glanced: "扫了一眼",
  deferred: "睡着了",
  running: "处理中",
  error: "失败",
  complete: "完成",
  stale: "旧稿作废",
  cancelled: "已取消",
  interrupted: "已中断",
};
const MODE_LABELS: Record<string, string> = {
  live: "真实聊天",
  demo: "模拟预览",
  replay: "测试回放",
  memory: "记忆整理",
  summary: "语境压缩",
};
const traces = ref<any[]>([]);
const selected = ref<any>(null);
const from = ref("");
const to = ref("");
const busy = ref(false);
const detail = ref(
  "选择一条处理记录，查看最终上下文、Prompt、原始输出、Token 与耗时。",
);

async function loadTraces() {
  if (!props.sessionId) return;
  traces.value = await listTraces(props.sessionId);
}

function range() {
  const seqs = props.events.map((e) => Number(e.seq));
  if (!seqs.length) return;
  if (!from.value) from.value = String(Math.min(...seqs));
  if (!to.value) to.value = String(Math.max(...seqs));
}

async function replay() {
  if (busy.value) return;
  busy.value = true;
  try {
    toast("回放正在运行");
    const result = await replayRange({
      session: props.sessionId,
      from: Number(from.value),
      to: Number(to.value),
    });
    detail.value = JSON.stringify(result, null, 2);
    toast("回放结束");
    await loadTraces();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function openTrace(id: string) {
  selected.value = await getTrace(id);
  detail.value = JSON.stringify(selected.value, null, 2);
}

function tokenSummary(tokens: any) {
  if (!tokens) return "—";
  return `输入 ${num(tokens.input)}（缓存读 ${num(tokens.cachedRead)} / 写 ${num(tokens.cacheWrite)}）· 输出 ${num(tokens.output)}`;
}

watch(
  () => [props.open, props.sessionId],
  () => {
    if (!props.open) return;
    from.value = "";
    to.value = "";
    selected.value = null;
    range();
    loadTraces();
  },
  { immediate: true },
);
watch(() => props.events.length, range);
</script>

<template>
  <Sheet
    :open="open"
    title="回到那一刻"
    eyebrow="REPLAY"
    width="1180px"
    @close="emit('close')"
  >
    <div class="replay">
      <section class="col source">
        <div class="col-head">
          <h3>历史消息</h3>
          <button
            id="loadMessages"
            class="small"
            @click="
              emit('load');
              loadTraces();
            "
          >
            ↻ 加载
          </button>
        </div>
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
              <tr v-for="r in [...events].reverse()" :key="r.seq">
                <td>{{ r.seq }}</td>
                <td>{{ r.payload.name }}</td>
                <td>{{ r.payload.text }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">当前会话暂无历史消息。</p>
        </div>
        <form class="range" @submit.prevent="replay">
          <label
            >起始序号<input v-model="from" name="from" type="number" required
          /></label>
          <label
            >截止序号<input v-model="to" name="to" type="number" required
          /></label>
          <button
            id="replay"
            class="primary"
            :disabled="busy || !events.length"
          >
            {{ busy ? "正在回放…" : "回放这段对话" }}
          </button>
          <p class="faint">
            隔离回放：只测试回复，不发送 QQ，不修改真实记忆和 TA 的心智。
          </p>
        </form>
      </section>
      <section class="col">
        <div class="col-head"><h3>处理记录</h3></div>
        <div id="traces" class="scroll-pane">
          <button
            v-for="t in traces"
            :key="t.id"
            :data-trace="t.id"
            class="trace-row"
            :class="{ selected: selected?.id === t.id }"
            @click="openTrace(t.id)"
          >
            <span
              ><time>{{ clockTime(t.time) }}</time
              ><small
                class="chip"
                :data-tone="t.status === 'error' ? 'danger' : 'quiet'"
                >{{ STATUS[t.status] || t.status }}</small
              ></span
            >
            <p>{{ t.reason || t.error || "查看处理详情" }}</p>
          </button>
          <p v-if="!traces.length" class="muted">
            有新的消息处理记录后会显示在这里。
          </p>
        </div>
      </section>
      <section class="col">
        <div class="col-head"><h3>运行详情</h3></div>
        <div class="scroll-pane inspect">
          <div v-if="selected" class="metrics">
            <span
              >模式<b>{{
                MODE_LABELS[selected.mode] || selected.mode
              }}</b></span
            >
            <span
              >耗时<b>{{ selected.data?.elapsed ?? "—" }} ms</b></span
            >
            <span
              >模型调用<b>{{ selected.data?.calls?.length ?? 0 }} 次</b></span
            >
            <span id="traceTokens"
              >Token<b>{{ tokenSummary(selected.data?.tokens) }}</b></span
            >
          </div>
          <p v-if="selected" class="notice">
            {{
              selected.reason ||
              selected.data?.decision?.reason ||
              "展开下方查看上下文、模型输入与原始输出。"
            }}
          </p>
          <pre id="traceDetail">{{ detail }}</pre>
        </div>
      </section>
    </div>
  </Sheet>
</template>

<style scoped>
.replay {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.8fr) minmax(0, 1.1fr);
  gap: 16px;
  height: calc(100dvh - 130px);
  min-height: 460px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--ink) 3%, transparent);
  border: 1px solid var(--line);
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.col-head h3 {
  font-size: 14px;
}
.col > .scroll-pane {
  flex: 1;
  min-height: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
th,
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  position: sticky;
  top: 0;
  background: var(--surface-strong);
  color: var(--ink-soft);
  font-weight: 600;
}
td:first-child {
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: end;
}
.range button,
.range p {
  grid-column: 1 / -1;
}
.trace-row {
  display: grid;
  gap: 4px;
  width: 100%;
  margin-bottom: 6px;
  padding: 10px 12px;
  border-radius: 14px;
  text-align: left;
  font-weight: 500;
}
.trace-row span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
}
.trace-row p {
  font-size: 12.5px;
}
.trace-row.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.metrics span {
  display: grid;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--surface-strong);
  color: var(--ink-soft);
  font-size: 11.5px;
}
.metrics b {
  color: var(--ink);
  font-size: 12.5px;
}
.notice {
  margin-bottom: 10px;
}
#traceDetail {
  padding: 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ink) 5%, transparent);
  font-size: 11.5px;
  line-height: 1.55;
}
@media (max-width: 1000px) {
  .replay {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
  .col > .scroll-pane {
    max-height: 420px;
  }
}
</style>
