<script setup lang="ts">
import { nextTick, ref } from "vue";
import { mind, CHOICE_LABELS } from "../../plates/mind";
import Empty from "../ui/Empty.vue";

// A preview conversation: the real pipeline reads TA's mind and memories,
// but nothing is written and nothing goes to QQ.
const props = withDefaults(
  defineProps<{
    sessions?: { id: string; name: string }[];
    nature?: Record<string, unknown> | null;
    anchored?: boolean;
    starter?: string;
  }>(),
  { sessions: () => [], nature: null, anchored: false, starter: "" },
);

interface Line {
  role: "user" | "assistant";
  text: string;
  bubbles?: string[];
  note?: string;
  why?: string;
}

const history = ref<Line[]>([]);
const text = ref(props.starter);
const viewSession = ref("");
const busy = ref(false);
const meta = ref(
  "试聊走真实链路：读取 TA 此刻的心智和记忆，但不写入，也不发 QQ。配置了模型时会消耗 Token。",
);
const log = ref<HTMLElement>();

async function scrollDown() {
  await nextTick();
  log.value?.scrollTo({ top: log.value.scrollHeight });
}

async function send() {
  const said = text.value.trim();
  if (busy.value || !said) return;
  busy.value = true;
  history.value.push({ role: "user", text: said });
  text.value = "";
  scrollDown();
  try {
    const r = await mind.preview({
      text: said,
      history: history.value
        .slice(0, -1)
        .slice(-12)
        .map(({ role, text }) => ({ role, text })),
      ...(props.nature ? { nature: props.nature } : {}),
      viewSession: viewSession.value,
    });
    if (r.reply)
      history.value.push({
        role: "assistant",
        text: r.reply,
        bubbles: r.bubbles?.length ? r.bubbles : [r.reply],
        note: [CHOICE_LABELS[r.choice] || r.choice, r.appraisal]
          .filter(Boolean)
          .join(" · "),
        why: r.reason,
      });
    else
      history.value.push({
        role: "assistant",
        text: "（TA 没有出声）",
        note: CHOICE_LABELS[r.choice] || "没出声",
        why: r.reason,
      });
    meta.value = `${r.mode === "model" ? "真实模型" : "本地样例（没有模型档案）"} · 心情${r.mood || "平静"} · ${r.latency} ms`;
  } catch (error) {
    history.value.pop();
    text.value = said;
    meta.value = (error as Error).message;
  } finally {
    busy.value = false;
    scrollDown();
  }
}

function clear() {
  history.value = [];
}
</script>

<template>
  <div class="ta-chat" :id="anchored ? 'ta-preview' : undefined">
    <p class="preview-meta" role="status">{{ meta }}</p>
    <div
      :id="anchored ? 'previewMessages' : undefined"
      ref="log"
      class="ta-chat-log scroll-pane"
    >
      <Empty
        v-if="!history.length && !busy"
        title="TA 会先理解，再决定说不说"
        text="回应会显示 TA 的选择和当时的想法。"
      />
      <article
        v-for="(line, i) in history"
        :key="i"
        class="preview-bubble"
        :class="line.role === 'assistant' ? 'bot' : 'me'"
      >
        <template v-if="line.bubbles">
          <p v-for="(b, j) in line.bubbles" :key="j">{{ b }}</p>
        </template>
        <p v-else>{{ line.text }}</p>
        <details v-if="line.note || line.why" class="why">
          <summary>{{ line.note || "为什么" }}</summary>
          <p>{{ line.why || "没有留下理由。" }}</p>
        </details>
      </article>
      <div v-if="busy" class="typing" aria-label="TA 在想">
        <i></i><i></i><i></i>
      </div>
    </div>
    <form
      :id="anchored ? 'previewForm' : undefined"
      class="ta-chat-form"
      @submit.prevent="send"
    >
      <div class="ta-chat-options">
        <label class="where">
          <span>想象在这里</span>
          <select v-model="viewSession" name="viewSession">
            <option value="">一段新的私聊</option>
            <option v-for="s in sessions" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </label>
        <slot name="options" />
        <button
          type="button"
          class="text-button"
          :disabled="!history.length"
          @click="clear"
        >
          清空
        </button>
      </div>
      <div class="composer">
        <input
          v-model="text"
          name="text"
          placeholder="说一句试试…"
          required
          maxlength="1000"
          autocomplete="off"
        />
        <button class="primary" :disabled="busy">
          {{ busy ? "TA 在想…" : "说" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.ta-chat {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
}
.preview-meta {
  font-size: 12px;
  color: var(--ink-soft);
}
.ta-chat-log {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 160px;
  padding: 4px 2px;
}
.preview-bubble {
  max-width: 88%;
  padding: 9px 13px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  animation: bubble-in 0.35s var(--spring);
}
.preview-bubble p + p {
  margin-top: 4px;
}
.preview-bubble.me {
  align-self: flex-end;
  border-bottom-right-radius: 6px;
  background: var(--accent);
  color: var(--accent-ink);
}
.preview-bubble.bot {
  align-self: flex-start;
  border-bottom-left-radius: 6px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--orb-a) 80%, var(--surface-strong)),
    color-mix(in srgb, var(--orb-b) 50%, var(--surface-strong))
  );
  color: var(--ink);
}
[data-mood="night"] .preview-bubble.bot {
  background: color-mix(in srgb, var(--orb-b) 40%, var(--surface-strong));
}
.why {
  margin-top: 6px;
  font-size: 12px;
}
.why summary {
  color: var(--ink-soft);
  font-weight: 600;
}
.why summary::before {
  content: "▸ ";
}
.why[open] summary::before {
  content: "▾ ";
}
.why p {
  margin-top: 4px;
  color: var(--ink-soft);
}
.typing {
  align-self: flex-start;
  display: inline-flex;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 18px 18px 18px 6px;
  background: color-mix(in srgb, var(--orb-a) 70%, var(--surface-strong));
}
.typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--orb-face);
  opacity: 0.5;
  animation: typing 1.1s ease-in-out infinite;
}
.typing i:nth-child(2) {
  animation-delay: 0.15s;
}
.typing i:nth-child(3) {
  animation-delay: 0.3s;
}
.ta-chat-form {
  display: grid;
  gap: 8px;
}
.ta-chat-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.where {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 180px;
}
.where span {
  white-space: nowrap;
}
.where select {
  padding: 6px 10px;
  font-size: 13px;
}
.composer {
  display: flex;
  gap: 8px;
}
.composer input {
  border-radius: 999px;
  padding-inline: 16px;
}
@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.97);
  }
}
@keyframes typing {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  50% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>
