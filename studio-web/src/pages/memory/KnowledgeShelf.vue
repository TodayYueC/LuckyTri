<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { toast } from "../../api";
import {
  ingestDocument,
  listCollections,
  listDocuments,
  searchKnowledge,
} from "../../plates/knowledge";
import { hueOf } from "../../format";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{ sessionId: string }>();
const collections = ref<any[]>([]);
const documents = ref<any[]>([]);
const collectionId = ref("shared-default");
const title = ref("");
const text = ref("");
const probe = ref("");
const hits = ref<any[] | null>(null);
const saving = ref(false);

async function load() {
  if (!props.sessionId) return;
  collections.value = await listCollections(props.sessionId);
  if (
    collections.value[0] &&
    !collections.value.some((c) => c.id === collectionId.value)
  )
    collectionId.value = collections.value[0].id;
  documents.value = collectionId.value
    ? await listDocuments(collectionId.value)
    : [];
}

async function ingest() {
  saving.value = true;
  try {
    await ingestDocument({
      collectionId: collectionId.value,
      title: title.value,
      text: text.value,
      embed: true,
    });
    title.value = "";
    text.value = "";
    await load();
    toast("文档已切分入库");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function search() {
  try {
    hits.value = await searchKnowledge(props.sessionId, probe.value);
  } catch (error) {
    toast((error as Error).message, true);
  }
}

watch(() => [props.sessionId, collectionId.value], load);
onMounted(load);
</script>

<template>
  <section class="shelf">
    <div class="card shelf-head">
      <div>
        <span class="eyebrow">资料书架</span>
        <h2>资料书架</h2>
        <p class="muted">
          存放可供聊天参考的资料，和自动记录的会话记忆分开管理。共享集合里的文章，TA
          独处时也会挑着读。
        </p>
      </div>
      <label class="collection">
        文档集合
        <select v-model="collectionId">
          <option v-for="c in collections" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="books">
      <article
        v-for="d in documents"
        :key="d.id"
        class="book"
        :style="{ '--hue': hueOf(d.title || d.id) }"
      >
        <span class="spine" aria-hidden="true"></span>
        <b>{{ d.title }}</b>
        <small class="chip" data-tone="quiet">{{ d.status }}</small>
      </article>
      <Empty
        v-if="!documents.length"
        title="书架还空着"
        text="在下面放一份资料，TA 就能在聊天里查到，独处时也可能去读。"
      />
    </div>

    <div class="grid-2">
      <details class="card add-doc">
        <summary>＋ 添加一份资料</summary>
        <form class="stack tight" @submit.prevent="ingest">
          <label>标题<input v-model="title" required /></label>
          <label
            >粘贴正文<textarea v-model="text" rows="8" required></textarea>
          </label>
          <button class="primary" :disabled="saving">保存到书架</button>
        </form>
      </details>
      <form class="card probe" @submit.prevent="search">
        <label>
          检索测试
          <div class="row">
            <input v-model="probe" placeholder="试着搜索一个关键词" />
            <button>检索</button>
          </div>
        </label>
        <p v-if="hits && !hits.length" class="muted">没有找到相关资料。</p>
        <p v-for="h in hits || []" :key="h.id" class="notice">
          <b>{{ h.title }}</b
          ><br />{{ h.text }}
        </p>
      </form>
    </div>
  </section>
</template>

<style scoped>
.shelf {
  display: grid;
  gap: var(--gap);
}
.shelf-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}
.shelf-head h2 {
  font-size: 19px;
}
.shelf-head p {
  max-width: 620px;
  margin-top: 4px;
  font-size: 13px;
}
.collection select {
  min-width: 200px;
}
.books {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  padding: 18px;
  border-radius: var(--r-l);
  background:
    repeating-linear-gradient(
      transparent 0 150px,
      color-mix(in srgb, var(--ink) 12%, transparent) 150px 156px
    ),
    var(--surface);
  border: 1px solid var(--line);
}
.books > .empty {
  grid-column: 1 / -1;
}
.book {
  position: relative;
  display: grid;
  align-content: space-between;
  gap: 10px;
  min-height: 130px;
  padding: 14px 12px 12px 22px;
  border-radius: 6px 14px 14px 6px;
  background: linear-gradient(
    160deg,
    hsl(var(--hue) 70% 88%),
    hsl(var(--hue) 55% 76%)
  );
  color: hsl(var(--hue) 45% 20%);
  box-shadow: var(--shadow-soft);
  transition: transform 0.3s var(--spring);
}
.book:hover {
  transform: translateY(-4px) rotate(-1deg);
}
.spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 10px;
  border-radius: 6px 0 0 6px;
  background: hsl(var(--hue) 45% 45%);
}
.book b {
  font-size: 14px;
  line-height: 1.4;
}
.book .chip {
  justify-self: start;
}
.add-doc summary {
  font-weight: 700;
}
.add-doc[open] summary {
  margin-bottom: 12px;
}
.probe .row input {
  flex: 1;
}
.probe .notice {
  margin-top: 10px;
}
</style>
