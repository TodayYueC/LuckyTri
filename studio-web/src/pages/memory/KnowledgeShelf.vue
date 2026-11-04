<script setup lang="ts">
import { t } from "../../i18n";
import { onMounted, ref, watch } from "vue";
import { api, toast } from "../../api";
import {
  ingestDocument,
  listCollections,
  listDocuments,
  searchKnowledge,
} from "../../plates/knowledge";
import { hueOf } from "../../format";
import Sheet from "../../components/ui/Sheet.vue";
import { ask } from "../../dialog";
import { studio } from "../../stores/studio";
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
const adding = ref(false);
async function closeAdd() {
  if (
    studio.dirty &&
    !(await ask(t("有尚未保存的修改，离开这一页吗？"), {
      title: t("草稿还没保存"),
      confirmText: t("离开"),
      cancelText: t("留下"),
    }))
  )
    return;
  adding.value = false;
  title.value = "";
  text.value = "";
  studio.dirty = false;
}
const rebuilding = ref("");
async function rebuild(id: string) {
  rebuilding.value = id;
  try {
    const result = await api(
      `/core/knowledge/documents/${encodeURIComponent(id)}/reembed`,
      "POST",
      {},
    );
    toast(t("已重建 {chunks} 段向量", { chunks: result.chunks }));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    rebuilding.value = "";
  }
}

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
    studio.dirty = false;
    adding.value = false;
    await load();
    toast(t("文档已切分入库"));
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
        <h2>{{ t("资料库") }}</h2>
        <small class="faint">{{
          t("资料书架，{length} 份资料", { length: documents.length })
        }}</small>
      </div>
      <label class="collection">
        {{ t("文档集合") }}
        <Select
          v-model="collectionId"
          :aria-label="t('文档集合')"
          :options="collections.map((c) => ({ value: c.id, label: c.name }))"
        />
      </label>
      <button class="primary" :disabled="!collectionId" @click="adding = true">
        {{ t("＋ 添加一份资料") }}
      </button>
    </div>

    <div
      class="books"
      :aria-label="t('资料书架，{length} 份资料', { length: documents.length })"
    >
      <article
        v-for="d in documents"
        :key="d.id"
        class="document-card card"
        :style="{ '--hue': hueOf(d.title || d.id) }"
      >
        <b>{{ d.title }}</b>
        <small class="chip" data-tone="quiet">{{ d.status }}</small>
        <button
          v-if="d.status === 'ready'"
          type="button"
          :disabled="!!rebuilding"
          @click="rebuild(d.id)"
        >
          {{ rebuilding === d.id ? t("正在重建…") : t("重建向量") }}
        </button>
      </article>
      <Empty
        v-if="!documents.length"
        :title="t('书架还空着')"
        :text="t('添加资料后，TA 可以在聊天和独处时阅读。')"
      />
    </div>

    <div class="knowledge-search">
      <form class="card probe" @submit.prevent="search">
        <label>
          {{ t("检索测试") }}
          <div class="row">
            <input v-model="probe" :placeholder="t('试着搜索一个关键词')" />
            <button>{{ t("检索") }}</button>
          </div>
        </label>
        <p v-if="hits && !hits.length" class="muted">
          {{ t("没有找到相关资料。") }}
        </p>
        <p v-for="h in hits || []" :key="h.id" class="notice">
          <b>{{ h.title }}</b
          ><br />{{ h.text }}
        </p>
      </form>
    </div>
    <Sheet
      :open="adding"
      :title="t('＋ 添加一份资料')"
      width="660px"
      @close="closeAdd"
      ><div class="add-doc">
        <form
          class="stack tight"
          @submit.prevent="ingest"
          @input="studio.dirty = true"
        >
          <label>{{ t("标题") }}<input v-model="title" required /></label>
          <label
            >{{ t("粘贴正文")
            }}<textarea v-model="text" rows="8" required></textarea>
          </label>
          <div class="save-bar">
            <button class="primary" :disabled="saving">
              {{ t("保存到书架") }}
            </button>
            <small class="faint">{{
              t("保存之后，TA 才能在聊天和独处时读到")
            }}</small>
          </div>
        </form>
      </div></Sheet
    >
  </section>
</template>

<style scoped src="./KnowledgeShelf.css"></style>
