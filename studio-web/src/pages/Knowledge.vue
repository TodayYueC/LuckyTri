<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { studio } from "../store";
import { toast } from "../api";
import {
  addMemory,
  consolidateMemory,
  deleteMemories,
  ingestDocument,
  listCollections,
  listDocuments,
  listMemorySummary,
  listMemories,
  patchMemory,
  reviewCandidate,
  searchKnowledge,
} from "../plates/knowledge";
import { fetchState } from "../plates/workspace";

const sessionId = ref(sessionStorage.memorySession || "");
const search = ref("");
const memories = ref<any[]>([]);
const memorySummary = ref<any>({
  summary: "请选择会话以查看最近的记忆总结。",
  updated: null,
  source: "empty",
});
const selectedMemoryIds = ref<string[]>([]);
const summaryLoading = ref(false);
const consolidating = ref(false);
const collections = ref<any[]>([]);
const documents = ref<any[]>([]);
const collectionId = ref("shared-default");
const docTitle = ref("");
const docText = ref("");
const probe = ref("");
const hits = ref<any[]>([]);
const review = ref<any | null>(null);
const reviewScope = ref("shared");
const reviewContent = ref("");
let timer: ReturnType<typeof setInterval>;

function sessions() {
  return studio.core?.sessions || [];
}
function candidates() {
  return studio.health?.candidates || [];
}

async function loadMemories() {
  if (!sessionId.value) return;
  sessionStorage.memorySession = sessionId.value;
  const [nextMemories, nextCollections, nextSummary] = await Promise.all([
    listMemories(sessionId.value),
    listCollections(sessionId.value),
    listMemorySummary(sessionId.value),
  ]);
  memories.value = nextMemories;
  memorySummary.value = nextSummary;
  const allowed = new Set(
    memories.value.filter(isSelectableMemory).map((m: any) => m.id),
  );
  selectedMemoryIds.value = selectedMemoryIds.value.filter((id) =>
    allowed.has(id),
  );
  collections.value = nextCollections;
  if (
    collections.value[0] &&
    !collections.value.some((c: any) => c.id === collectionId.value)
  )
    collectionId.value = collections.value[0].id;
  documents.value = collectionId.value
    ? await listDocuments(collectionId.value)
    : [];
}

watch([sessionId, collectionId], loadMemories);
onMounted(async () => {
  if (!sessionId.value && sessions()[0]) sessionId.value = sessions()[0].id;
  await loadMemories();
  timer = setInterval(() => {
    if (!studio.dirty) loadMemories();
  }, 4000);
});
onUnmounted(() => clearInterval(timer));

async function addConfirmed(e: Event) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form)) as any;
  await addMemory(data);
  form.reset();
  (form.elements.namedItem("session") as HTMLSelectElement).value =
    sessionId.value;
  await loadMemories();
  toast("记忆已写入");
}

async function changeMemory(m: any, action: string) {
  const content = (
    document.querySelector(`[data-content="${m.id}"]`) as HTMLTextAreaElement
  )?.value;
  await patchMemory(
    m.id,
    action === "lock" ? { locked: !m.locked } : { status: action, content },
  );
  await loadMemories();
}

async function ingest(e: Event) {
  e.preventDefault();
  await ingestDocument({
    collectionId: collectionId.value,
    title: docTitle.value,
    text: docText.value,
    embed: true,
  });
  docText.value = "";
  await loadMemories();
  toast("文档已切分入库");
}

async function searchHits(e: Event) {
  e.preventDefault();
  hits.value = await searchKnowledge(sessionId.value, probe.value);
}

async function acceptReview() {
  try {
    await reviewCandidate(review.value.id, {
      action: "accept",
      content: reviewContent.value,
      scope: reviewScope.value,
    });
    review.value = null;
    studio.health = await fetchState();
    await loadMemories();
  } catch (err) {
    toast((err as Error).message);
  }
}

function openReview(c: any) {
  review.value = c;
  reviewContent.value = c.content;
  reviewScope.value = c.scope;
}

function isSelectableMemory(m: any) {
  return (
    m.session_id === sessionId.value && !m.locked && m.status !== "deleted"
  );
}

function memorySelected(id: string) {
  return selectedMemoryIds.value.includes(id);
}

function toggleMemory(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedMemoryIds.value = checked
    ? [...new Set([...selectedMemoryIds.value, id])]
    : selectedMemoryIds.value.filter((item) => item !== id);
}

function selectAllMemories() {
  selectedMemoryIds.value = memories.value
    .filter(isSelectableMemory)
    .map((m) => m.id);
}

function clearMemorySelection() {
  selectedMemoryIds.value = [];
}

async function deleteSelectedMemories() {
  if (!selectedMemoryIds.value.length) return;
  if (
    !window.confirm(
      `确定删除已选的 ${selectedMemoryIds.value.length} 条记忆吗？`,
    )
  )
    return;
  try {
    const result = await deleteMemories({
      session: sessionId.value,
      ids: selectedMemoryIds.value,
    });
    selectedMemoryIds.value = [];
    await loadMemories();
    toast(`已删除 ${result.deleted || 0} 条记忆`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function deleteAllSessionMemories() {
  const count = memories.value.filter(isSelectableMemory).length;
  if (!count) return;
  if (!window.confirm(`确定清空本会话的 ${count} 条可删除记忆吗？`)) return;
  try {
    const result = await deleteMemories({
      session: sessionId.value,
      all: true,
    });
    selectedMemoryIds.value = [];
    await loadMemories();
    toast(`已删除 ${result.deleted || 0} 条记忆`);
  } catch (err) {
    toast((err as Error).message);
  }
}

async function refreshSummary() {
  if (!sessionId.value) return;
  summaryLoading.value = true;
  try {
    memorySummary.value = await listMemorySummary(sessionId.value);
  } catch (err) {
    toast((err as Error).message);
  } finally {
    summaryLoading.value = false;
  }
}

async function runConsolidate() {
  if (!sessionId.value || consolidating.value) return;
  consolidating.value = true;
  try {
    await consolidateMemory(sessionId.value);
    await refreshSummary();
    await loadMemories();
    toast("记忆已整理");
  } catch (err) {
    toast((err as Error).message);
  } finally {
    consolidating.value = false;
  }
}

const filtered = () =>
  memories.value.filter((m) => JSON.stringify(m).includes(search.value));
</script>

<template>
  <section class="panel">
    <div class="row">
      <label
        >记忆所属会话
        <select id="memoryScope" v-model="sessionId">
          <option v-for="s in sessions()" :key="s.id" :value="s.id">
            {{ s.name }} · {{ s.id }}
          </option>
        </select>
      </label>
      <input
        id="memorySearch"
        v-model="search"
        placeholder="搜索当前会话的内容或用户"
      />
    </div>
    <p class="small">
      记忆候选/事实与文档集合在同一空间。群聊默认不装入私聊集合。
    </p>
    <section id="memorySummary" class="memory-summary">
      <div class="row">
        <h2>最近记忆总结</h2>
        <div class="row">
          <button
            id="refreshMemorySummary"
            type="button"
            @click="refreshSummary"
          >
            {{ summaryLoading ? "刷新中…" : "刷新总结" }}
          </button>
          <button
            id="consolidateMemory"
            type="button"
            class="primary"
            :disabled="consolidating"
            @click="runConsolidate"
          >
            {{ consolidating ? "整理中…" : "立即整理" }}
          </button>
        </div>
      </div>
      <p data-memory-summary>{{ memorySummary.summary }}</p>
      <p v-if="memorySummary.updated" class="small">
        最近整理：{{ new Date(memorySummary.updated).toLocaleString() }}
      </p>
      <p v-else class="small">
        总结来自当前会话的阶段记忆，不会覆盖已有长期记忆。
      </p>
    </section>
    <div class="row memory-batch-toolbar">
      <button id="selectAllMemories" type="button" @click="selectAllMemories">
        全选本会话
      </button>
      <button
        id="clearMemorySelection"
        type="button"
        :disabled="!selectedMemoryIds.length"
        @click="clearMemorySelection"
      >
        取消选择
      </button>
      <button
        id="deleteSelectedMemories"
        type="button"
        class="danger"
        :disabled="!selectedMemoryIds.length"
        @click="deleteSelectedMemories"
      >
        删除已选（{{ selectedMemoryIds.length }}）
      </button>
      <button
        id="deleteAllSessionMemories"
        type="button"
        class="danger"
        :disabled="!memories.filter(isSelectableMemory).length"
        @click="deleteAllSessionMemories"
      >
        清空本会话
      </button>
    </div>
    <div id="memoryList">
      <details v-for="m in filtered()" :key="m.id" class="panel memory">
        <summary>
          <span>{{ m.content }} · {{ m.status }}</span>
          <span v-if="m.session_id !== sessionId" class="small">共享/继承</span>
          <span v-else-if="m.locked" class="small">已锁定</span>
        </summary>
        <label v-if="m.session_id === sessionId" class="memory-select check">
          <input
            type="checkbox"
            :data-memory-select="m.id"
            :checked="memorySelected(m.id)"
            :disabled="!isSelectableMemory(m)"
            @change="toggleMemory(m.id, $event)"
          />
          选择这条记忆
        </label>
        <p class="small">
          {{ m.session_id }} / {{ m.subject }} · {{ m.whySelected || "" }}
        </p>
        <textarea :data-content="m.id">{{ m.content }}</textarea>
        <div class="row">
          <button @click="changeMemory(m, 'confirmed')">确认 / 保存</button>
          <button @click="changeMemory(m, 'lock')">
            {{ m.locked ? "解锁" : "锁定" }}
          </button>
          <button @click="changeMemory(m, 'deleted')">删除</button>
        </div>
      </details>
      <p v-if="!filtered().length" class="small">暂无匹配记忆。</p>
    </div>
  </section>
  <section class="panel">
    <h2>新增确认记忆</h2>
    <form id="addMemory" @submit="addConfirmed">
      <div class="grid">
        <label
          >所属会话
          <select id="memorySession" name="session" v-model="sessionId">
            <option v-for="s in sessions()" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </label>
        <label>用户 QQ<input name="subject" required pattern="\d+" /></label>
        <label>已确认的事实<input name="content" required /></label>
      </div>
      <button class="primary">新增人工记忆</button>
    </form>
  </section>
  <section class="panel">
    <h2>待审核候选</h2>
    <article v-for="c in candidates()" :key="c.id" class="memory">
      <p>{{ c.content }}</p>
      <button data-review @click="openReview(c)">审核</button>
    </article>
    <p v-if="!candidates().length" class="small">没有待审核候选。</p>
    <dialog v-if="review" open>
      <form @submit.prevent="acceptReview">
        <h3>确认这条记忆</h3>
        <label>内容<input v-model="reviewContent" name="content" /></label>
        <label
          >范围
          <select v-model="reviewScope" name="scope">
            <option value="shared">共享</option>
            <option :value="review.scope">{{ review.scope }}</option>
            <option value="private">仅私聊</option>
          </select>
        </label>
        <button type="button" class="primary" @click="acceptReview">
          保存
        </button>
        <button type="button" @click="review = null">取消</button>
      </form>
    </dialog>
  </section>
  <section class="panel">
    <h2>文档集合</h2>
    <label
      >集合
      <select v-model="collectionId">
        <option v-for="c in collections" :key="c.id" :value="c.id">
          {{ c.name }} · {{ c.scope }}
        </option>
      </select>
    </label>
    <form @submit="ingest">
      <label>标题<input v-model="docTitle" required /></label>
      <label
        >粘贴文本 / Markdown / HTML<textarea
          v-model="docText"
          class="editor"
          required
        ></textarea>
      </label>
      <button class="primary">上传并切分</button>
    </form>
    <p v-for="d in documents" :key="d.id" class="small">
      {{ d.title }} · {{ d.status }}
    </p>
    <form @submit="searchHits">
      <label>命中测试<input v-model="probe" /></label>
      <button>检索</button>
    </form>
    <p v-for="h in hits" :key="h.id" class="small">
      {{ h.title }} · {{ h.whySelected }} · {{ h.text }}
    </p>
  </section>
</template>
