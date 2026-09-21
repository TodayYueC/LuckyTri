<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { pages, studio, reload, go } from "./store";
import { subscribe } from "./sse";
import { toast } from "./api";
import Overview from "./pages/Overview.vue";
import Live from "./pages/Live.vue";
import Knowledge from "./pages/Knowledge.vue";
import Character from "./pages/Character.vue";
import Spaces from "./pages/Spaces.vue";
import Models from "./pages/Models.vue";
import Connect from "./pages/Connect.vue";
import Lab from "./pages/Lab.vue";

const views: Record<string, object> = {
  overview: Overview,
  live: Live,
  knowledge: Knowledge,
  character: Character,
  spaces: Spaces,
  models: Models,
  connect: Connect,
  lab: Lab,
};

function onHash() {
  const next = location.hash.slice(1);
  if (Object.hasOwn(pages, next)) studio.page = next as keyof typeof pages;
}

onMounted(async () => {
  window.addEventListener("hashchange", onHash);
  try {
    await reload();
  } catch (e) {
    studio.error = (e as Error).message;
  }
  subscribe(async () => {
    if (!studio.dirty) {
      try {
        await reload();
      } catch {
        /* keep last good snapshot */
      }
    }
  });
});
onUnmounted(() => window.removeEventListener("hashchange", onHash));

async function refresh() {
  if (studio.dirty) {
    toast("请先保存草稿");
    return;
  }
  await reload();
}
</script>

<template>
  <div v-if="studio.error" class="startup">
    <h1>暂时无法连接工作室</h1>
    <p>{{ studio.error }}</p>
    <button class="primary" @click="location.reload()">重新连接</button>
  </div>
  <div v-else-if="studio.core && studio.health" class="studio">
    <aside class="sidebar">
      <div class="brand">LuckyBot<span style="color: #8caec4">.</span></div>
      <div class="subtitle">群友工作室<br />CONVERSATION STUDIO</div>
      <nav>
        <button
          v-for="(label, key) in pages"
          :key="key"
          :data-page="key"
          :class="{ active: studio.page === key }"
          @click="go(key)"
        >
          {{ label }}
        </button>
      </nav>
      <div class="footer">
        <a href="/guide.html">使用教程 ↗</a>
      </div>
    </aside>
    <main>
      <header>
        <div>
          <div class="subtitle">
            WORKSPACE / {{ studio.page.toUpperCase() }}
          </div>
          <h1>{{ pages[studio.page] }}</h1>
        </div>
        <div class="row">
          <span class="pill" id="connection">{{
            studio.health.connection.online ? "QQ 已连接" : "QQ 未连接"
          }}</span>
          <button id="refresh" @click="refresh">刷新</button>
        </div>
      </header>
      <component :is="views[studio.page]" />
    </main>
  </div>
</template>
