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
import Select from "../../components/ui/Select.vue";

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
        <h2>给 TA 留一点可以读的东西</h2>
        <p class="muted">
          存放可供聊天参考的资料，和自动记录的会话记忆分开管理。共享集合里的文章，TA
          独处时也会挑着读。
        </p>
      </div>
      <label class="collection">
        文档集合
        <Select
          v-model="collectionId"
          aria-label="文档集合"
          :options="collections.map((c) => ({ value: c.id, label: c.name }))"
        />
      </label>
    </div>

    <div class="books" :aria-label="`资料书架，${documents.length} 份资料`">
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
          <div class="save-bar">
            <button class="primary" :disabled="saving">保存到书架</button>
            <small class="faint">保存之后，TA 才能在聊天和独处时读到</small>
          </div>
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

<style scoped src="./KnowledgeShelf.css"></style>
