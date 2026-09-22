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
const section = ref("memories");
const adding = ref(false);
const expandedSummary = ref(false);
const memoryStatus: Record<string, string> = {
  confirmed: "已确认",
  candidate: "待确认",
  disputed: "有争议",
  expired: "已过期",
  deleted: "已删除",
};
const visibleCount = ref(20);
watch([sessionId, search], () => {
  visibleCount.value = 20;
});
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
  return (studio.health?.candidates || []).filter(
    (c: any) => c.scope === sessionId.value,
  );
}

async function loadMemories() {
  if (!sessionId.value) return;
  const requestedSession = sessionId.value;
  sessionStorage.memorySession = requestedSession;
  const [nextMemories, nextCollections, nextSummary] = await Promise.all([
    listMemories(sessionId.value),
    listCollections(sessionId.value),
    listMemorySummary(sessionId.value),
  ]);
  if (sessionId.value !== requestedSession) return;
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
  const named = (memorySummary.value.participants || []).find(
    (person: any) => person.name === String(data.subject || "").trim(),
  );
  if (named) data.subject = named.id;
  await addMemory(data);
  form.reset();
  (form.elements.namedItem("session") as HTMLSelectElement).value =
    sessionId.value;
  adding.value = false;
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
  memories.value.filter(
    (m) => m.status !== "deleted" && JSON.stringify(m).includes(search.value),
  );
</script>

<template>
  <div class="memory-workbench master-detail">
    <aside class="master-list surface">
      <div class="section-heading">
        <h2>会话记忆</h2>
        <span class="eyebrow">ARCHIVE</span>
      </div>
      <label class="mobile-select"
        >当前会话<select id="memoryScope" v-model="sessionId">
          <option value="" disabled>选择会话</option>
          <option v-for="s in sessions()" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select></label
      >
      <div class="list-scroll">
        <button
          v-for="s in sessions()"
          :key="s.id"
          class="entity-row"
          :class="{ selected: sessionId === s.id }"
          @click="sessionId = s.id"
        >
          <span class="entity-symbol">{{
            s.kind === "group" ? "群" : "私"
          }}</span
          ><span
            ><b>{{ s.name }}</b
            ><small>{{ s.id }}</small></span
          >
        </button>
        <p v-if="!sessions().length" class="empty-copy">
          先在“对话 → 会话设置”添加会话。
        </p>
      </div>
      <div class="master-caption">
        MEMORIES MAKE<br /><em>US WHO WE ARE.</em><span>✦</span>
      </div>
    </aside>
    <section class="detail-pane surface">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">MEMORY / COLLECTION</span>
          <h2>
            {{
              sessions().find((s: any) => s.id === sessionId)?.name ||
              "记忆档案"
            }}
          </h2>
        </div>
        <button :disabled="!sessionId" @click="adding = true">
          ＋ 手动记忆
        </button>
      </div>
      <div class="segment-tabs">
        <button
          :class="{ active: section === 'memories' }"
          :aria-pressed="section === 'memories'"
          @click="section = 'memories'"
        >
          会话记忆</button
        ><button
          :class="{ active: section === 'documents' }"
          :aria-pressed="section === 'documents'"
          @click="section = 'documents'"
        >
          文档知识库</button
        ><button
          :class="{ active: section === 'review' }"
          @click="section = 'review'"
        >
          待审核 {{ candidates().length || "" }}
        </button>
      </div>
      <div v-show="section === 'memories'" class="memory-main">
        <section id="memorySummary" class="memory-summary">
          <div class="section-heading">
            <h3>最近发生了什么</h3>
            <div class="row">
              <button
                id="refreshMemorySummary"
                :disabled="summaryLoading || !sessionId"
                @click="refreshSummary"
              >
                {{ summaryLoading ? "刷新中…" : "↻" }}</button
              ><button
                id="consolidateMemory"
                :disabled="consolidating || !sessionId"
                @click="runConsolidate"
              >
                {{ consolidating ? "整理中…" : "整理记忆" }}
              </button>
            </div>
          </div>
          <p data-memory-summary :class="{ 'summary-clamp': !expandedSummary }">
            {{ memorySummary.summary }}
          </p>
          <div class="summary-meta">
            <span>{{
              memorySummary.updated
                ? new Date(memorySummary.updated).toLocaleString()
                : "尚未整理"
            }}</span
            ><button @click="expandedSummary = !expandedSummary">
              {{ expandedSummary ? "收起 ↑" : "展开 ↓" }}
            </button>
          </div>
        </section>
        <div class="memory-tools">
          <input
            id="memorySearch"
            v-model="search"
            placeholder="搜索记忆、人物或关键词"
            aria-label="搜索记忆"
          />
          <div class="row">
            <button id="selectAllMemories" @click="selectAllMemories">
              全选</button
            ><button
              id="clearMemorySelection"
              :disabled="!selectedMemoryIds.length"
              @click="clearMemorySelection"
            >
              取消选择</button
            ><button
              id="deleteSelectedMemories"
              class="danger"
              :disabled="!selectedMemoryIds.length"
              @click="deleteSelectedMemories"
            >
              删除已选 {{ selectedMemoryIds.length || "" }}</button
            ><button
              id="deleteAllSessionMemories"
              class="danger push-end"
              :disabled="!memories.filter(isSelectableMemory).length"
              @click="deleteAllSessionMemories"
            >
              清空本会话
            </button>
          </div>
        </div>
        <div id="memoryList" class="scroll-pane">
          <article
            v-for="m in filtered().slice(0, visibleCount)"
            :key="m.id"
            class="memory-row"
          >
            <input
              type="checkbox"
              :aria-label="'选择记忆：' + m.content"
              :data-memory-select="m.id"
              :checked="memorySelected(m.id)"
              :disabled="!isSelectableMemory(m)"
              @change="toggleMemory(m.id, $event)"
            />
            <details class="memory">
              <summary>
                <span>{{ m.content }}</span
                ><small class="status-tag"
                  >{{ memoryStatus[m.status] || m.status }}
                  {{ m.locked ? "· 已锁定" : "" }}</small
                >
              </summary>
              <p class="small">
                {{ m.subjectName || m.subject }} ·
                {{ m.session_id === sessionId ? "本会话" : "共享 / 继承" }}
              </p>
              <textarea
                :data-content="m.id"
                :aria-label="'编辑记忆：' + (m.subjectName || m.subject)"
                >{{ m.content }}</textarea>
              <div class="row">
                <button @click="changeMemory(m, 'confirmed')">
                  确认 / 保存</button
                ><button @click="changeMemory(m, 'lock')">
                  {{ m.locked ? "解锁" : "锁定" }}</button
                ><button class="danger" @click="changeMemory(m, 'deleted')">
                  删除
                </button>
              </div>
            </details>
          </article>
          <button
            v-if="filtered().length > visibleCount"
            @click="visibleCount += 20"
          >
            再显示 20 条
          </button>
          <div v-if="!filtered().length" class="empty-state">
            <span>◌</span>
            <h3>这里还有空白</h3>
            <p>聊天中的重要信息，或手动添加的记忆会保存在这里。</p>
          </div>
        </div>
        <div class="pane-foot">
          <span>共 {{ filtered().length }} 条记忆</span
          ><span>共享与锁定记忆不会被批量选中</span>
        </div>
      </div>
      <div v-show="section === 'documents'" class="document-main scroll-pane">
        <h3>文档知识库</h3>
        <p class="small">
          存放可供聊天参考的资料，与自动记录的会话记忆分开管理。
        </p>
        <label
          >文档集合<select v-model="collectionId">
            <option v-for="c in collections" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select></label
        >
        <details>
          <summary>＋ 添加一份资料</summary>
          <form @submit="ingest">
            <label>标题<input v-model="docTitle" required /></label
            ><label
              >粘贴正文<textarea
                v-model="docText"
                class="editor"
                required
              ></textarea></label
            ><button class="primary">保存到知识库</button>
          </form>
        </details>
        <article class="document-item" v-for="d in documents" :key="d.id">
          <b>{{ d.title }}</b
          ><span class="status-tag">{{ d.status }}</span>
        </article>
        <form @submit="searchHits">
          <label
            >查找资料
            <div class="composer">
              <input v-model="probe" placeholder="试着搜索一个关键词" /><button>
                检索 ↗
              </button>
            </div></label
          >
        </form>
        <p v-for="h in hits" :key="h.id" class="notice">
          {{ h.title }}<br />{{ h.text }}
        </p>
      </div>
      <div v-show="section === 'review'" class="scroll-pane review-main">
        <article v-for="c in candidates()" :key="c.id" class="review-item">
          <p>{{ c.content }}</p>
          <button data-review @click="openReview(c)">审核 ↗</button>
        </article>
        <div v-if="!candidates().length" class="empty-state">
          <span>✓</span>
          <h3>没有待审核的明确记忆请求</h3>
          <p>自动整理的候选记忆可在“会话记忆”里展开确认。</p>
        </div>
      </div>
    </section>
  </div>
  <div v-if="adding" class="modal-backdrop" @click.self="adding = false">
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="addMemoryTitle"
    >
      <div class="section-heading">
        <h2 id="addMemoryTitle">手动记住一件事</h2>
        <button aria-label="关闭" @click="adding = false">×</button>
      </div>
      <form id="addMemory" @submit="addConfirmed">
        <label
          >所属会话<select
            id="memorySession"
            name="session"
            v-model="sessionId"
          >
            <option v-for="s in sessions()" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select></label
        ><label
          >用户 ID<input
            name="subject"
            required
            list="memoryUsers"
            placeholder="选择昵称，或填写用户 ID" /></label
        ><datalist id="memoryUsers">
          <option
            v-for="person in memorySummary.participants || []"
            :key="person.id"
            :value="person.name"
          ></option>
        </datalist>
        <label>已确认的事实<input name="content" required /></label>
        ><button class="primary">新增人工记忆 ↗</button>
      </form>
    </section>
  </div>
  <div v-if="review" class="modal-backdrop" @click.self="review = null">
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="确认记忆"
    >
      <h2>确认这条记忆</h2>
      <form @submit.prevent="acceptReview">
        <label>内容<input v-model="reviewContent" name="content" /></label
        ><label
          >范围<select v-model="reviewScope" name="scope">
            <option value="shared">共享</option>
            <option :value="review.scope">当前会话</option>
            <option value="private">仅私聊</option>
          </select></label
        >
        <div class="row">
          <button class="primary">保存</button
          ><button type="button" @click="review = null">取消</button>
        </div>
      </form>
    </section>
  </div>
</template>
