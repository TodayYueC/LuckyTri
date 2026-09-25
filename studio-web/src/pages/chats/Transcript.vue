<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { getTrace } from "../../plates/live";
import { clockTime, hueOf, initials } from "../../format";
import { studio } from "../../stores/studio";
import Empty from "../../components/ui/Empty.vue";
import Select from "../../components/ui/Select.vue";

const props = defineProps<{
  session: any;
  sessionId: string;
  events: any[];
  traces: any[];
  decisions: any[];
  status: string;
  demo: boolean;
  compact: boolean;
  sending: boolean;
}>();
const emit = defineEmits<{
  simulate: [body: { userId: string; text: string; mentioned: boolean }];
  feedback: [id: number, tag: string];
  openList: [];
  openReplay: [];
}>();

const DIVIDERS: Record<string, string> = {
  glanced: "TA 扫了一眼",
  silent: "TA 看了，没出声",
  deferred: "TA 睡着了，醒来再看",
};
const userId = ref("10001");
const text = ref("");
const mentioned = ref(true);
const composer = ref<HTMLTextAreaElement>();
const why = ref<Record<number, { loading: boolean; detail: any }>>({});

type Item =
  | { type: "message"; key: string; time: number; event: any }
  | { type: "day"; key: string; time: number; label: string }
  | {
      type: "divider";
      key: string;
      time: number;
      status: string;
      reasons: string[];
      count: number;
    };

const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

const timeline = computed<Item[]>(() => {
  const items: Item[] = props.events.map((e) => ({
    type: "message",
    key: "m" + e.seq,
    time: e.time,
    event: e,
  }));
  const first = props.events[0]?.time ?? Number.MAX_SAFE_INTEGER;
  for (const t of props.traces)
    if (DIVIDERS[t.status] && t.time >= first)
      items.push({
        type: "divider",
        key: "t" + t.id,
        time: t.time,
        status: t.status,
        reasons: [t.reason].filter(Boolean),
        count: 1,
      });
  items.sort((a, b) => a.time - b.time);
  const merged: Item[] = [];
  let day = "";
  for (const item of items) {
    const label = dayFormat.format(item.time);
    if (label !== day) {
      day = label;
      merged.push({
        type: "day",
        key: "d" + item.time,
        time: item.time,
        label,
      });
    }
    const last = merged[merged.length - 1];
    if (
      item.type === "divider" &&
      last?.type === "divider" &&
      last.status === item.status
    ) {
      last.count += 1;
      if (item.reasons[0] && !last.reasons.includes(item.reasons[0]))
        last.reasons.push(item.reasons[0]);
      continue;
    }
    merged.push(item);
  }
  return merged;
});

function decisionFor(e: any) {
  const said = String(e.payload.text || "");
  return props.decisions
    .filter(
      (d) =>
        d.session_id === e.session_id &&
        d.reply &&
        d.reply.includes(said) &&
        Math.abs(d.time - e.time) < 600000,
    )
    .sort((a, b) => Math.abs(a.time - e.time) - Math.abs(b.time - e.time))[0];
}

function traceFor(e: any) {
  return props.traces
    .filter((t) => t.status === "sent" && t.time <= e.time + 1000)
    .sort((a, b) => b.time - a.time)[0];
}

async function toggleWhy(e: any) {
  if (why.value[e.seq]) {
    const { [e.seq]: _drop, ...rest } = why.value;
    why.value = rest;
    return;
  }
  why.value = { ...why.value, [e.seq]: { loading: true, detail: null } };
  const trace = traceFor(e);
  let detail = null;
  try {
    detail = trace ? await getTrace(trace.id) : null;
  } catch {
    detail = null;
  }
  if (why.value[e.seq])
    why.value = { ...why.value, [e.seq]: { loading: false, detail } };
}

async function focusComposer() {
  await nextTick();
  composer.value?.focus();
}

function submit() {
  if (!text.value.trim() || props.sending) return;
  emit("simulate", {
    userId: userId.value,
    text: text.value,
    mentioned: mentioned.value,
  });
  text.value = "";
}

defineExpose({ focusComposer });
</script>

<template>
  <section class="transcript">
    <header class="t-head">
      <button
        v-if="compact"
        class="icon-button"
        aria-label="全部会话"
        title="全部会话"
        @click="emit('openList')"
      >
        ☰
      </button>
      <span
        v-if="session"
        class="badge"
        :style="{ '--hue': hueOf(session.id) }"
        >{{ session.kind === "private" ? "私" : "群" }}</span
      >
      <div class="t-title">
        <h2>{{ session?.name || "选择一段对话" }}</h2>
        <span id="liveStatus" class="faint">{{ status }}</span>
      </div>
      <div class="t-tools">
        <button
          class="small sim-button"
          :disabled="!sessionId"
          @click="focusComposer"
        >
          模拟消息
        </button>
        <button class="small" @click="emit('openReplay')">回到那一刻</button>
      </div>
    </header>

    <div id="liveMessages" class="chat-messages scroll-pane">
      <template v-for="item in timeline" :key="item.key">
        <div v-if="item.type === 'day'" class="day-label">
          <span>{{ item.label }}</span>
        </div>
        <div
          v-else-if="item.type === 'divider'"
          class="divider"
          :data-status="item.status"
        >
          <span
            >{{ DIVIDERS[item.status]
            }}{{ item.count > 1 ? ` × ${item.count}` : "" }}</span
          >
          <small v-if="item.reasons.length">{{
            item.reasons.slice(0, 2).join("；")
          }}</small>
        </div>
        <article
          v-else
          class="message"
          :class="{
            bot: item.event.role === 'assistant',
            simulated: item.event.payload.simulated,
          }"
        >
          <span
            v-if="item.event.role !== 'assistant'"
            class="avatar"
            :style="{
              '--hue': hueOf(
                String(item.event.payload.userId || item.event.payload.name),
              ),
            }"
            aria-hidden="true"
            >{{ initials(item.event.payload.name) }}</span
          >
          <div class="body">
            <div class="message-meta">
              <b>{{ item.event.payload.name }}</b>
              <time>{{ clockTime(item.event.time) }}</time>
              <span
                v-if="item.event.payload.simulated"
                class="chip"
                data-tone="warn"
                >模拟</span
              >
            </div>
            <p class="text">{{ item.event.payload.text }}</p>
            <template v-if="item.event.role === 'assistant'">
              <button
                class="text-button why-toggle"
                :aria-expanded="Boolean(why[item.event.seq])"
                @click="toggleWhy(item.event)"
              >
                {{ why[item.event.seq] ? "收起" : "为什么这么说" }}
              </button>
              <div v-if="why[item.event.seq]" class="why">
                <p v-if="why[item.event.seq].loading" class="muted">
                  正在翻当时的记录…
                </p>
                <template v-else>
                  <p
                    v-if="why[item.event.seq].detail?.data?.decision?.appraisal"
                  >
                    <b>TA 当时的理解：</b
                    >{{ why[item.event.seq].detail.data.decision.appraisal }}
                  </p>
                  <p>
                    <b>理由：</b
                    >{{
                      why[item.event.seq].detail?.data?.reason ||
                      why[item.event.seq].detail?.data?.decision?.reason ||
                      decisionFor(item.event)?.reason ||
                      "没有留下理由。"
                    }}
                  </p>
                  <p
                    v-if="
                      why[item.event.seq].detail?.data?.snapshot?.knowledge
                        ?.length
                    "
                  >
                    <b>引用的资料：</b
                    >{{
                      why[item.event.seq].detail.data.snapshot.knowledge
                        .map((k: any) => k.title)
                        .join("、")
                    }}
                  </p>
                  <label v-if="decisionFor(item.event)" class="fb">
                    这句怎么样？
                    <Select
                      :model-value="decisionFor(item.event).feedback || ''"
                      aria-label="这句怎么样？"
                      :options="[
                        { value: '', label: '选择评价' },
                        ...Object.entries(studio.health.feedbackLabels || {}).map(
                          ([tag, label]) => ({ value: tag, label: String(label) }),
                        ),
                      ]"
                      @update:model-value="
                        emit('feedback', decisionFor(item.event).id, $event)
                      "
                    />
                  </label>
                </template>
              </div>
            </template>
          </div>
        </article>
      </template>
      <Empty
        v-if="!events.length"
        :title="sessionId ? '等待新的消息' : '选择一段对话'"
        text="群聊与私聊消息会在这里实时出现；TA 扫一眼、没出声也会留下一条分隔线。"
      />
    </div>

    <form v-if="demo" id="simulate" class="composer" @submit.prevent="submit">
      <div class="composer-note">
        <span class="chip" data-tone="warn">模拟消息</span>
        <span class="faint"
          >作为一条模拟消息走完整流程，写进模拟会话；不会发到
          QQ，也不进入真实记忆。</span
        >
      </div>
      <div class="composer-row">
        <label class="uid">
          <span class="sr-only">体验用户 ID</span>
          <input
            v-model="userId"
            name="userId"
            pattern="\d{4,20}"
            required
            title="体验用户 ID"
          />
        </label>
        <textarea
          ref="composer"
          v-model="text"
          name="text"
          rows="1"
          placeholder="以这位群友的身份说一句…"
          required
          @keydown.enter.exact.prevent="submit"
        ></textarea>
        <label class="check mention"
          ><input v-model="mentioned" type="checkbox" />视为 @</label
        >
        <button class="primary" :disabled="sending || !sessionId">
          {{ sending ? "TA 在想…" : "发送模拟消息" }}
        </button>
      </div>
    </form>
    <div v-else class="composer off">
      <span class="faint"
        >真实模式下不能模拟消息。想看看 TA 会怎么回，可以「和 TA
        聊聊」——那是试聊，什么都不写入。</span
      >
      <button class="small" @click="studio.chatOpen = true">和 TA 聊聊</button>
    </div>
  </section>
</template>

<style scoped>
.transcript {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  isolation: isolate;
}
.t-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--line);
}
.badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: hsl(var(--hue) 70% 88%);
  color: hsl(var(--hue) 45% 25%);
  font-weight: 700;
}
.t-title {
  flex: 1;
  display: grid;
  min-width: 120px;
}
.t-title h2 {
  overflow: hidden;
  font-size: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-tools {
  display: flex;
  gap: 6px;
}
.sim-button {
  border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  color: var(--warn);
}
.chat-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 20px 14px;
  border: 1px solid rgb(255 255 255 / 0.65);
  border-radius: 24px;
  background:
    radial-gradient(
      circle at 12% 12%,
      color-mix(in srgb, var(--glow-a) 22%, transparent),
      transparent 34%
    ),
    radial-gradient(
      circle at 90% 68%,
      color-mix(in srgb, var(--glow-b) 19%, transparent),
      transparent 42%
    ),
    rgb(255 255 255 / 0.24);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.86);
}
.day-label {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 700;
}
.day-label::before,
.day-label::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}
.divider {
  display: grid;
  justify-items: center;
  gap: 2px;
  margin: 2px 0;
  text-align: center;
}
.divider span {
  padding: 3px 12px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.52);
  border: 1px solid rgb(255 255 255 / 0.8);
  box-shadow: inset 0 1px 0 white;
  color: var(--ink-soft);
  font-size: 11.5px;
  font-weight: 600;
}
.divider small {
  max-width: 80%;
  color: var(--ink-faint);
  font-size: 11px;
}
.message {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 82%;
  animation: msg-in 0.5s var(--jelly);
}
.message.bot {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, white, hsl(var(--hue) 75% 86%));
  color: hsl(var(--hue) 45% 25%);
  font-size: 11px;
  font-weight: 700;
  box-shadow:
    inset 0 1px 0 white,
    0 6px 12px -10px hsl(var(--hue) 48% 35%);
}
.body {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.bot .body {
  justify-items: end;
}
.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ink-soft);
}
.message-meta time {
  font-variant-numeric: tabular-nums;
}
.text {
  padding: 9px 14px;
  border-radius: 18px 18px 18px 6px;
  background: rgb(255 255 255 / 0.75);
  border: 1px solid rgb(255 255 255 / 0.85);
  box-shadow:
    inset 0 1px 0 white,
    0 10px 26px -24px var(--ink);
  backdrop-filter: blur(16px) saturate(1.5);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.bot .text {
  border-radius: 18px 18px 6px 18px;
  border-color: rgb(255 255 255 / 0.72);
  background: linear-gradient(
    135deg,
    rgb(255 255 255 / 0.91),
    color-mix(in srgb, var(--orb-a) 48%, rgb(255 255 255 / 0.8)) 52%,
    color-mix(in srgb, var(--orb-b) 26%, rgb(255 255 255 / 0.8))
  );
  box-shadow:
    inset 0 1px 0 white,
    0 12px 26px -18px color-mix(in srgb, var(--orb-c) 48%, transparent);
}
[data-mood="night"] .bot .text {
  background: color-mix(in srgb, var(--orb-b) 42%, var(--surface-strong));
}
.simulated .text {
  border: 1.5px dashed color-mix(in srgb, var(--warn) 55%, transparent);
}
.why-toggle {
  font-size: 12px;
}
.why {
  display: grid;
  gap: 6px;
  max-width: 420px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgb(255 255 255 / 0.63);
  border: 1px solid rgb(255 255 255 / 0.83);
  box-shadow: inset 0 1px 0 white;
  backdrop-filter: blur(18px);
  font-size: 12.5px;
  text-align: left;
}
.fb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.fb select {
  width: auto;
  padding: 4px 8px;
  font-size: 12px;
}
.composer {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.composer-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.composer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.uid input {
  width: 96px;
  padding: 8px 10px;
  border-radius: 999px;
  font-size: 13px;
}
.composer textarea {
  flex: 1 1 220px;
  min-height: 40px;
  max-height: 140px;
  padding: 9px 14px;
  border-radius: 20px;
  border-color: color-mix(in srgb, var(--warn) 30%, var(--line));
  resize: none;
}
.mention {
  font-size: 12.5px;
}
.composer.off {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}
@keyframes msg-in {
  0% {
    opacity: 0;
    transform: translateY(14px) scale(0.9, 0.82);
  }
  62% {
    opacity: 1;
    transform: translateY(-4px) scale(1.03, 0.98);
  }
  100% {
    transform: none;
  }
}
@media (max-width: 760px) {
  .message {
    max-width: 94%;
  }
}
</style>
