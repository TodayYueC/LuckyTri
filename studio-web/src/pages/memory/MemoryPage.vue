<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import Tabs from "../../components/ui/Tabs.vue";
import MemoryArchive from "./MemoryArchive.vue";
import KnowledgeShelf from "./KnowledgeShelf.vue";

const sessions = computed(() => studio.core?.sessions || []);
const saved = sessionStorage.memorySession;
const sessionId = ref(
  sessions.value.some((s: any) => s.id === saved)
    ? saved
    : sessions.value[0]?.id || "",
);
const view = ref(studio.sub === "shelf" ? "shelf" : "memories");

watch(view, (next) => setSub(next === "shelf" ? "shelf" : ""));
watch(
  () => studio.sub,
  (sub) => {
    view.value = sub === "shelf" ? "shelf" : "memories";
  },
);
</script>

<template>
  <div class="page memory-page">
    <header class="memory-intro">
      <div>
        <span class="eyebrow">MEMORY · 记忆</span>
        <h1>见过的人与事，<em>会慢慢有了重量。</em></h1>
        <p>记住重要的，也允许改变看法。</p>
      </div>
      <div class="memory-drop" aria-hidden="true"><span></span></div>
    </header>
    <Tabs
      v-model="view"
      label="记忆的分区"
      :items="[
        { key: 'memories', label: 'TA 记得的事' },
        { key: 'shelf', label: '资料书架' },
      ]"
    />
    <p v-if="!sessions.length" class="notice">
      先在「对话」里添加一个会话，TA 才有地方认识人、记住事。
    </p>
    <MemoryArchive v-if="view === 'memories'" v-model:session-id="sessionId" />
    <KnowledgeShelf v-else :session-id="sessionId" />
  </div>
</template>

<style scoped src="./MemoryPage.css"></style>
