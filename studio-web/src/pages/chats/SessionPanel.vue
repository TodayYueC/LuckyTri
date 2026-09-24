<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { studio } from "../../stores/studio";
import { clockTime } from "../../format";
import Tabs from "../../components/ui/Tabs.vue";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{
  session: any;
  group: any;
  summaries: any[];
  decisions: any[];
}>();
const settingsOpen = defineModel<boolean>("settingsOpen", { default: false });
const tab = defineModel<string>("tab", { default: "here" });
const emit = defineEmits<{
  toggle: [session: any];
  archive: [id: string];
  clear: [];
  save: [policy: Record<string, unknown>];
  feedback: [id: number, tag: string];
}>();

const LEVEL_LABELS = ["近期细摘要", "中期摘要", "较早摘要", "远期摘要"];
const PAGE = 6;
const page = ref(0);
const replies = computed(() =>
  props.decisions.filter((d) => d.session_id === props.session?.id && d.reply),
);
const pages = computed(() =>
  Math.max(1, Math.ceil(replies.value.length / PAGE)),
);
const models = computed(() => studio.core.models || []);

watch(
  () => props.session?.id,
  () => (page.value = 0),
);

function modelChoice(session: any) {
  const id = session.policy?.modelId;
  if (id && models.value.some((m: any) => m.id === id)) return id;
  return (
    models.value.find((m: any) => m.isDefault)?.id || models.value[0]?.id || ""
  );
}

function submit(event: Event) {
  const form = event.target as HTMLFormElement;
  const value: Record<string, unknown> = Object.fromEntries(new FormData(form));
  for (const key of ["aggregateMs", "maxWaitMs", "contextMessages", "maxReply"])
    value[key] = Number(value[key]);
  for (const key of ["memory", "selectiveVision", "deepCheck", "compaction"])
    value[key] = (form.elements.namedItem(key) as HTMLInputElement).checked;
  value.fallbackModelId = String(value.fallbackModelId || "");
  emit("save", value);
}
</script>

<template>
  <section class="panel">
    <Tabs
      v-model="tab"
      label="这个会话"
      :items="[
        { key: 'here', label: '这个会话' },
        { key: 'feedback', label: '反馈' },
      ]"
    />

    <div v-if="!session" class="panel-body">
      <Empty title="还没有选中会话" text="从左边选一个群聊或私聊。" />
    </div>

    <div v-else-if="tab === 'here'" class="panel-body scroll-pane">
      <div class="here">
        <div class="facts">
          <div>
            <span class="eyebrow">TA 在这里的样子</span>
            <p v-if="group?.face">
              {{
                [group.face.role, group.face.tone]
                  .filter(Boolean)
                  .join(" · ") ||
                group.face.content ||
                "还在慢慢形成"
              }}
            </p>
            <p v-else class="muted">还没有形成在这里的样子。</p>
            <small v-if="group?.face?.aspiration" class="faint"
              >想成为：{{ group.face.aspiration }}</small
            >
          </div>
          <div>
            <span class="eyebrow">{{
              session.kind === "private"
                ? "这段私聊给 TA 的感觉"
                : "这个群给 TA 的感觉"
            }}</span>
            <p>{{ group?.bond?.feel || "刚来这里不久" }}</p>
          </div>
        </div>
        <p class="faint">
          在这里开不开口由 TA 自己决定：没有参与概率和冷却。TA
          对这里每个人的感觉在「人际」里看。
        </p>
        <div class="row actions">
          <button
            id="toggleSession"
            :data-toggle="session.id"
            :class="{ primary: !session.enabled }"
            @click="emit('toggle', session)"
          >
            {{ session.enabled ? "暂停参与" : "开启参与" }}
          </button>
          <button
            :data-archive="session.id"
            @click="emit('archive', session.id)"
          >
            归档
          </button>
          <button id="clearLiveContext" @click="emit('clear')">
            清空上下文
          </button>
        </div>

        <details
          class="fold session-settings"
          :open="settingsOpen"
          @toggle="settingsOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>会话设置</summary>
          <form
            :key="session.id"
            :data-session="session.id"
            class="stack tight"
            @submit.prevent="submit"
            @input="studio.dirty = true"
          >
            <label>
              模型
              <select name="modelId" :value="modelChoice(session)">
                <option v-if="!models.length" value="">尚未添加模型</option>
                <option v-for="m in models" :key="m.id" :value="m.id">
                  {{ m.label || m.model }}{{ m.isDefault ? " · 默认" : "" }}
                </option>
              </select>
            </label>
            <label>
              视觉兼容模型
              <select
                name="visionModelId"
                :value="session.policy.visionModelId || ''"
              >
                <option value="">跟随主模型</option>
                <option
                  v-for="m in models.filter((x: any) => x.vision)"
                  :key="m.id"
                  :value="m.id"
                >
                  {{ m.label || m.model }}
                </option>
              </select>
            </label>
            <label>
              备用模型（主模型连不上时接替）
              <select
                name="fallbackModelId"
                :value="session.policy.fallbackModelId || ''"
              >
                <option value="">不使用</option>
                <option
                  v-for="m in models.filter(
                    (x: any) => x.id !== modelChoice(session),
                  )"
                  :key="m.id"
                  :value="m.id"
                >
                  {{ m.label || m.model }}
                </option>
              </select>
            </label>
            <label class="check">
              <input
                name="selectiveVision"
                type="checkbox"
                :checked="session.policy.selectiveVision"
              />节能看图：只在被 @ 或明确要求时，看这一条和附近的图
            </label>
            <details class="advanced-policy">
              <summary>高级策略</summary>
              <div class="stack tight">
                <label
                  >聚合窗口 ms<input
                    name="aggregateMs"
                    type="number"
                    :value="session.policy.aggregateMs"
                /></label>
                <label
                  >最长等待 ms<input
                    name="maxWaitMs"
                    type="number"
                    :value="session.policy.maxWaitMs"
                /></label>
                <label
                  >近期原文条数（10–500）<input
                    name="contextMessages"
                    type="number"
                    min="10"
                    max="500"
                    :value="session.policy.contextMessages"
                /></label>
                <label
                  >一轮总字数<input
                    name="maxReply"
                    type="number"
                    :value="session.policy.maxReply"
                /></label>
                <label class="check"
                  ><input
                    name="compaction"
                    type="checkbox"
                    :checked="session.policy.compaction !== false"
                  />上下文压缩：更早的聊天定期整理成分层摘要，越近越详细</label
                >
                <label class="check"
                  ><input
                    name="memory"
                    type="checkbox"
                    :checked="session.policy.memory"
                  />长期记忆</label
                >
                <label class="check"
                  ><input
                    name="deepCheck"
                    type="checkbox"
                    :checked="session.policy.deepCheck"
                  />倾诉、纠正和危机时额外复审一次回复</label
                >
              </div>
            </details>
            <button class="primary" type="submit">保存会话设置</button>
            <small class="faint">保存后下一轮生效</small>
          </form>
        </details>

        <details class="fold summary-list">
          <summary>语境摘要 · {{ summaries.length }} 段</summary>
          <p v-if="!summaries.length" class="muted">
            还没有摘要。聊天超过近期原文条数后，更早的内容会自动整理到这里。
          </p>
          <article v-for="item in summaries" :key="item.id" class="summary">
            <header>
              <b>{{ LEVEL_LABELS[item.level] || "摘要" }}</b>
              <small class="faint"
                >{{ item.period }} · {{ item.messages }} 条消息</small
              >
            </header>
            <p>{{ item.summary }}</p>
            <ul v-if="item.keyPoints?.length">
              <li v-for="(point, index) in item.keyPoints" :key="index">
                {{ point.open ? "未完：" : "" }}{{ point.text }}
              </li>
            </ul>
          </article>
        </details>
      </div>
    </div>

    <div v-else class="panel-body feedback-pane">
      <p class="faint">
        针对具体回复评价口吻；这是 TA 在这个会话里听到的话，不会改写天性。
      </p>
      <div id="feedbackList" class="scroll-pane">
        <article
          v-for="d in replies.slice(page * PAGE, page * PAGE + PAGE)"
          :key="d.id"
          class="feedback-item"
        >
          <time class="faint">{{ clockTime(d.time) }}</time>
          <p class="reply-excerpt">{{ d.reply }}</p>
          <label>
            这句回复怎么样？
            <select
              :data-feedback="d.id"
              :value="d.feedback || ''"
              @change="
                emit(
                  'feedback',
                  d.id,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">选择评价</option>
              <option
                v-for="(label, tagKey) in studio.health.feedbackLabels"
                :key="tagKey"
                :value="tagKey"
              >
                {{ label }}
              </option>
            </select>
          </label>
        </article>
        <p v-if="!replies.length" class="muted">还没有可以评价的回复。</p>
      </div>
      <div class="pagination">
        <button class="small" :disabled="page === 0" @click="page--">←</button>
        <span>{{ page + 1 }} / {{ pages }}</span>
        <button class="small" :disabled="page + 1 >= pages" @click="page++">
          →
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}
.panel > .tabs {
  align-self: flex-start;
}
.panel-body {
  flex: 1;
  min-height: 0;
}
.here {
  display: grid;
  gap: 14px;
}
.facts {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: linear-gradient(
    150deg,
    color-mix(in srgb, var(--orb-a) 45%, var(--surface-strong)),
    color-mix(in srgb, var(--surface-strong) 80%, transparent)
  );
  border: 1px solid var(--line);
}
.facts p {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 600;
}
.actions button {
  flex: 1 1 auto;
}
.fold {
  padding: 12px 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
  border: 1px solid var(--line);
}
.fold > summary {
  font-weight: 700;
  font-size: 13.5px;
}
.fold > summary::before {
  content: "▸ ";
  color: var(--accent);
}
.fold[open] > summary {
  margin-bottom: 12px;
}
.fold[open] > summary::before {
  content: "▾ ";
}
.advanced-policy {
  padding: 8px 0;
}
.advanced-policy summary {
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}
.advanced-policy[open] summary {
  margin-bottom: 10px;
}
.summary {
  display: grid;
  gap: 4px;
  padding: 10px 0;
  border-top: 1px dashed var(--line);
  font-size: 13px;
}
.summary header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.summary ul {
  margin: 0;
  padding-left: 18px;
}
.feedback-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.feedback-pane > p {
  font-size: 12px;
}
#feedbackList {
  flex: 1;
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 120px;
}
.feedback-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-strong) 75%, transparent);
  border: 1px solid var(--line);
}
.reply-excerpt {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13.5px;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.feedback-item select {
  padding: 6px 10px;
  font-size: 13px;
}
</style>
