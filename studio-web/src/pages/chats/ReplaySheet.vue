<script setup lang="ts">
import { t, N_, localized } from "../../i18n";
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

const STATUS: Record<string, string> = localized({
  sent: N_("开口了"),
  silent: N_("没出声"),
  glanced: N_("扫了一眼"),
  deferred: N_("睡着了"),
  running: N_("处理中"),
  error: N_("失败"),
  complete: N_("完成"),
  stale: N_("旧稿作废"),
  cancelled: N_("已取消"),
  interrupted: N_("已中断"),
});
const MODE_LABELS: Record<string, string> = localized({
  live: N_("真实聊天"),
  demo: N_("模拟预览"),
  replay: N_("测试回放"),
  memory: N_("记忆整理"),
  summary: N_("语境压缩"),
});
const traces = ref<any[]>([]);
const selected = ref<any>(null);
const from = ref("");
const to = ref("");
const busy = ref(false);
const detail = ref("");

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
    toast(t("回放正在运行"));
    const result = await replayRange({
      session: props.sessionId,
      from: Number(from.value),
      to: Number(to.value),
    });
    detail.value = JSON.stringify(result, null, 2);
    toast(t("回放结束"));
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
  return t("输入 {v}（缓存读 {v2} / 写 {v3}）· 输出 {v4}", {
    v: num(tokens.input),
    v2: num(tokens.cachedRead),
    v3: num(tokens.cacheWrite),
    v4: num(tokens.output),
  });
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
    :title="t('回到那一刻')"
    eyebrow="REPLAY"
    width="1180px"
    @close="emit('close')"
  >
    <div class="replay">
      <section class="col source">
        <div class="col-head">
          <h3>{{ t("历史消息") }}</h3>
          <button
            id="loadMessages"
            class="small"
            @click="
              emit('load');
              loadTraces();
            "
          >
            {{ t("↻ 加载") }}
          </button>
        </div>
        <div id="events" class="scroll-pane">
          <table v-if="events.length">
            <thead>
              <tr>
                <th>{{ t("序号") }}</th>
                <th>{{ t("发送者") }}</th>
                <th>{{ t("消息") }}</th>
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
          <p v-else class="muted">{{ t("当前会话暂无历史消息。") }}</p>
        </div>
        <form class="range" @submit.prevent="replay">
          <label
            >{{ t("起始序号")
            }}<input v-model="from" name="from" type="number" required
          /></label>
          <label
            >{{ t("截止序号")
            }}<input v-model="to" name="to" type="number" required
          /></label>
          <button
            id="replay"
            class="primary"
            :disabled="busy || !events.length"
          >
            {{ busy ? t("正在回放…") : t("回放这段对话") }}
          </button>
          <p class="faint">
            {{
              t("隔离回放：只测试回复，不发送 QQ，不修改真实记忆和 TA 的心智。")
            }}
          </p>
        </form>
      </section>
      <section class="col">
        <div class="col-head">
          <h3>{{ t("处理记录") }}</h3>
        </div>
        <div id="traces" class="scroll-pane">
          <button
            v-for="run in traces"
            :key="run.id"
            :data-trace="run.id"
            class="trace-row"
            :class="{ selected: selected?.id === run.id }"
            @click="openTrace(run.id)"
          >
            <span
              ><time>{{ clockTime(run.time) }}</time
              ><small
                class="chip"
                :data-tone="run.status === 'error' ? 'danger' : 'quiet'"
                >{{ STATUS[run.status] || run.status }}</small
              ></span
            >
            <p>{{ run.reason || run.error || t("查看处理详情") }}</p>
          </button>
          <p v-if="!traces.length" class="muted">
            {{ t("有新的消息处理记录后会显示在这里。") }}
          </p>
        </div>
      </section>
      <section class="col">
        <div class="col-head">
          <h3>{{ t("运行详情") }}</h3>
        </div>
        <div class="scroll-pane inspect">
          <div v-if="selected" class="metrics">
            <span
              >{{ t("模式")
              }}<b>{{ MODE_LABELS[selected.mode] || selected.mode }}</b></span
            >
            <span
              >{{ t("耗时")
              }}<b>{{ selected.data?.elapsed ?? "—" }} ms</b></span
            >
            <span
              >{{ t("模型调用")
              }}<b>{{
                t("{v} 次", { v: selected.data?.calls?.length ?? 0 })
              }}</b></span
            >
            <span id="traceTokens"
              >Token<b>{{ tokenSummary(selected.data?.tokens) }}</b></span
            >
          </div>
          <p v-if="selected" class="notice">
            {{
              selected.reason ||
              selected.data?.decision?.reason ||
              t("展开下方查看上下文、模型输入与原始输出。")
            }}
          </p>
          <pre id="traceDetail">{{
            detail ||
            t(
              "选择一条处理记录，查看最终上下文、Prompt、原始输出、Token 与耗时。",
            )
          }}</pre>
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
