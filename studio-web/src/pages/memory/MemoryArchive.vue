<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { toast } from "../../api";
import { ask, askText } from "../../dialog";
import { studio } from "../../stores/studio";
import {
  addMemory,
  consolidateMemory,
  deleteMemories,
  listMemorySummary,
  listMemories,
  patchMemory,
} from "../../plates/knowledge";
import { DISCRETION, MEMORY_STATUS, mind } from "../../plates/mind";
import { placeName, sessionChoices } from "../../format";
import Sheet from "../../components/ui/Sheet.vue";
import Select from "../../components/ui/Select.vue";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ "update:sessionId": [id: string] }>();

const search = ref("");
const person = ref("");
const adding = ref(false);
const expanded = ref(false);
const visible = ref(20);
const memories = ref<any[]>([]);
const summary = ref<any>({
  summary: "请选择会话以查看最近的记忆总结。",
  updated: null,
  source: "empty",
});
const selected = ref<string[]>([]);
const summaryLoading = ref(false);
const consolidating = ref(false);
let timer = 0;

const sessions = computed(() => studio.core?.sessions || []);
const scope = computed({
  get: () => props.sessionId,
  set: (id: string) => emit("update:sessionId", id),
});
const people = computed(() => {
  const map = new Map<string, string>();
  for (const m of memories.value)
    if (m.subject)
      map.set(String(m.subject), m.subjectName || String(m.subject));
  return [...map.entries()];
});
const filtered = computed(() =>
  memories.value.filter(
    (m) =>
      m.status !== "deleted" &&
      (!person.value || String(m.subject) === person.value) &&
      JSON.stringify(m).includes(search.value),
  ),
);
const selectable = computed(() => memories.value.filter(isSelectable));

function isSelectable(m: any) {
  return (
    m.session_id === props.sessionId && !m.locked && m.status !== "deleted"
  );
}

async function load() {
  if (!props.sessionId) return;
  const requested = props.sessionId;
  sessionStorage.memorySession = requested;
  const [list, nextSummary] = await Promise.all([
    listMemories(requested),
    listMemorySummary(requested),
  ]);
  if (props.sessionId !== requested) return;
  memories.value = list;
  summary.value = nextSummary;
  const allowed = new Set(list.filter(isSelectable).map((m: any) => m.id));
  selected.value = selected.value.filter((id) => allowed.has(id));
}

watch(
  () => props.sessionId,
  () => {
    visible.value = 20;
    person.value = "";
    load();
  },
);
watch(search, () => (visible.value = 20));

onMounted(() => {
  load();
  timer = window.setInterval(() => {
    if (!studio.dirty && !adding.value) load();
  }, 4000);
});
onUnmounted(() => clearInterval(timer));

async function add(event: Event) {
  const form = event.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form)) as any;
  const named = (summary.value.participants || []).find(
    (p: any) => p.name === String(data.subject || "").trim(),
  );
  if (named) data.subject = named.id;
  try {
    await addMemory(data);
    form.reset();
    adding.value = false;
    await load();
    toast("记忆已写入");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function change(m: any, action: string) {
  if (action === "revoke") {
    const reason = await askText(
      `撤销「${m.content}」？TA 之后不会再这样认为，整理记忆时也不会把它写回来。可以写下原因（可不填）：`,
      {
        title: "撤销这条记忆",
        confirmText: "撤销",
        danger: true,
        placeholder: "原因",
      },
    );
    if (reason === null) return;
    try {
      await mind.revoke("memory", m.id, reason);
    } catch (error) {
      toast((error as Error).message, true);
    }
    await load();
    return;
  }
  const content = (
    document.querySelector(`[data-content="${m.id}"]`) as HTMLTextAreaElement
  )?.value;
  await patchMemory(
    m.id,
    action === "lock"
      ? { locked: !m.locked }
      : action.startsWith("discretion:")
        ? { discretion: action.slice(11) }
        : { status: "confirmed", content },
  );
  await load();
}

function toggle(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selected.value = checked
    ? [...new Set([...selected.value, id])]
    : selected.value.filter((x) => x !== id);
}

async function deleteSelected() {
  if (!selected.value.length) return;
  if (
    !(await ask(`确定删除已选的 ${selected.value.length} 条记忆吗？`, {
      title: "删除记忆",
      confirmText: "删除",
      danger: true,
    }))
  )
    return;
  try {
    const result = await deleteMemories({
      session: props.sessionId,
      ids: selected.value,
    });
    selected.value = [];
    await load();
    toast(`已删除 ${result.deleted || 0} 条记忆`);
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function deleteAll() {
  const count = selectable.value.length;
  if (!count) return;
  if (
    !(await ask(`确定清空本会话的 ${count} 条可删除记忆吗？`, {
      title: "清空本会话记忆",
      confirmText: "清空",
      danger: true,
    }))
  )
    return;
  try {
    const result = await deleteMemories({
      session: props.sessionId,
      all: true,
    });
    selected.value = [];
    await load();
    toast(`已删除 ${result.deleted || 0} 条记忆`);
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function refreshSummary() {
  if (!props.sessionId) return;
  summaryLoading.value = true;
  try {
    summary.value = await listMemorySummary(props.sessionId);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    summaryLoading.value = false;
  }
}

async function consolidate() {
  if (!props.sessionId || consolidating.value) return;
  consolidating.value = true;
  try {
    await consolidateMemory(props.sessionId);
    await refreshSummary();
    await load();
    toast("记忆已整理");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    consolidating.value = false;
  }
}
</script>

<template>
  <section class="archive">
    <div class="archive-bar card">
      <label class="scope">
        <span>在哪里知道的</span>
        <Select
          id="memoryScope"
          v-model="scope"
          aria-label="在哪里知道的"
          :options="sessionChoices(sessions, '选择会话')"
        />
      </label>
      <label class="scope">
        <span>关于谁</span>
        <Select
          v-model="person"
          aria-label="按人筛选"
          :options="[
            { value: '', label: '所有人' },
            ...people.map(([id, name]) => ({ value: id, label: name })),
          ]"
        />
      </label>
      <input
        id="memorySearch"
        v-model="search"
        type="search"
        placeholder="搜索记忆、人物或关键词"
        aria-label="搜索记忆"
      />
      <button class="primary" :disabled="!sessionId" @click="adding = true">
        ＋ 手动记忆
      </button>
    </div>

    <section id="memorySummary" class="card summary-card">
      <div class="card-head">
        <div>
          <span class="eyebrow">最近发生了什么</span>
          <h2>
            {{
              (sessions.find((s: any) => s.id === sessionId)
                ? placeName(sessions.find((s: any) => s.id === sessionId))
                : "记忆档案")
            }}
          </h2>
        </div>
        <div class="row">
          <button
            id="refreshMemorySummary"
            class="icon-button"
            :disabled="summaryLoading || !sessionId"
            aria-label="刷新总结"
            @click="refreshSummary"
          >
            ↻
          </button>
          <button
            id="consolidateMemory"
            :disabled="consolidating || !sessionId"
            @click="consolidate"
          >
            {{ consolidating ? "整理中…" : "立即整理" }}
          </button>
        </div>
      </div>
      <p data-memory-summary :class="{ clamp: !expanded }">
        {{ summary.summary }}
      </p>
      <div class="row between faint">
        <span>{{
          summary.updated
            ? new Date(summary.updated).toLocaleString()
            : "尚未整理"
        }}</span>
        <button class="text-button" @click="expanded = !expanded">
          {{ expanded ? "收起" : "展开" }}
        </button>
      </div>
    </section>

    <section class="card list-card">
      <div class="tools row">
        <button
          id="selectAllMemories"
          class="small"
          @click="selected = selectable.map((m) => m.id)"
        >
          全选
        </button>
        <button
          id="clearMemorySelection"
          class="small"
          :disabled="!selected.length"
          @click="selected = []"
        >
          取消选择
        </button>
        <button
          id="deleteSelectedMemories"
          class="small danger"
          :disabled="!selected.length"
          @click="deleteSelected"
        >
          删除已选 {{ selected.length || "" }}
        </button>
        <button
          id="deleteAllSessionMemories"
          class="small danger push"
          :disabled="!selectable.length"
          @click="deleteAll"
        >
          清空本会话
        </button>
      </div>
      <div id="memoryList" class="scroll-pane">
        <article
          v-for="m in filtered.slice(0, visible)"
          :key="m.id"
          class="memory-row"
          :class="{ superseded: m.status === 'superseded' }"
        >
          <input
            type="checkbox"
            :aria-label="'选择记忆：' + m.content"
            :data-memory-select="m.id"
            :checked="selected.includes(m.id)"
            :disabled="!isSelectable(m)"
            @change="toggle(m.id, $event)"
          />
          <details class="memory">
            <summary>
              <span class="content">{{ m.content }}</span>
              <span class="tags">
                <span
                  class="chip"
                  :data-tone="m.status === 'confirmed' ? undefined : 'quiet'"
                  >{{ MEMORY_STATUS[m.status] || m.status }}</span
                >
                <span class="chip" data-tone="quiet">{{
                  DISCRETION[m.discretion] || "公开"
                }}</span>
                <span v-if="m.locked" class="chip" data-tone="warn"
                  >已锁定</span
                >
              </span>
            </summary>
            <p class="faint meta">
              关于 {{ m.subjectName || m.subject }} ·
              {{ m.session_id === sessionId ? "在这里知道的" : "别处知道的" }} ·
              把握 {{ Math.round((m.confidence ?? 1) * 100) }}%
            </p>
            <textarea
              :data-content="m.id"
              :aria-label="'编辑记忆：' + (m.subjectName || m.subject)"
              >{{ m.content }}</textarea>
            <div class="row">
              <button class="small" @click="change(m, 'confirmed')">
                保存修改
              </button>
              <small class="faint">编辑后要点保存</small>
              <Select
                :aria-label="'分寸：' + m.content"
                :model-value="m.discretion || 'open'"
                :options="
                  Object.entries(DISCRETION).map(([key, label]) => ({
                    value: key,
                    label,
                  }))
                "
                @update:model-value="change(m, 'discretion:' + $event)"
              />
              <button class="small" @click="change(m, 'lock')">
                {{ m.locked ? "解锁" : "锁定" }}
              </button>
              <button class="small danger" @click="change(m, 'revoke')">
                撤销
              </button>
            </div>
          </details>
        </article>
        <button
          v-if="filtered.length > visible"
          class="small more"
          @click="visible += 20"
        >
          再显示 20 条
        </button>
        <Empty
          v-if="!filtered.length"
          title="这里还有空白"
          text="别人说「记住……」、聊天积累后的自动整理，或你手动添加的事会出现在这里。TA 对所有会话只有一份记忆：别处知道的事只在相关时想起，私下知道的不当众说，要 TA 保密的不离开原处。"
        />
      </div>
      <div class="row between faint foot">
        <span>共 {{ filtered.length }} 条记忆</span>
        <span>共享与锁定的记忆不会被批量选中</span>
      </div>
    </section>

    <Sheet
      :open="adding"
      title="手动记住一件事"
      eyebrow="REMEMBER"
      width="440px"
      @close="adding = false"
    >
      <form id="addMemory" class="stack" @submit.prevent="add">
        <label>
          所属会话
          <Select
            id="memorySession"
            v-model="scope"
            name="session"
            aria-label="所属会话"
            :options="sessionChoices(sessions)"
          />
        </label>
        <label>
          用户 ID
          <input
            name="subject"
            required
            list="memoryUsers"
            placeholder="选择昵称，或填写用户 ID"
          />
        </label>
        <datalist id="memoryUsers">
          <option
            v-for="p in summary.participants || []"
            :key="p.id"
            :value="p.name"
          ></option>
        </datalist>
        <label>已确认的事实<input name="content" required /></label>
        <button class="primary">新增人工记忆</button>
      </form>
    </Sheet>
  </section>
</template>

<style scoped src="./MemoryArchive.css"></style>
