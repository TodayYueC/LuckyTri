<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { pageFromHash, studio, reload, go } from "./store";
import { subscribe } from "./sse";
import { toast } from "./api";
import Overview from "./pages/Overview.vue";
import Live from "./pages/Live.vue";
import Knowledge from "./pages/Knowledge.vue";
import Her from "./pages/Her.vue";
import Spaces from "./pages/Spaces.vue";
import Models from "./pages/Models.vue";
import Connect from "./pages/Connect.vue";
import Lab from "./pages/Lab.vue";

const views: Record<string, object> = {
  overview: Overview,
  live: Live,
  knowledge: Knowledge,
  her: Her,
  spaces: Spaces,
  models: Models,
  connect: Connect,
  lab: Lab,
};

const navigation = [
  {
    key: "overview",
    label: "今日",
    en: "TODAY",
    number: "01",
    pages: ["overview"],
  },
  {
    key: "live",
    label: "对话",
    en: "SOCIAL LINK",
    number: "02",
    pages: ["live", "spaces", "lab"],
  },
  {
    key: "her",
    label: "她",
    en: "HER LIFE",
    number: "03",
    pages: ["her"],
  },
  {
    key: "knowledge",
    label: "记忆",
    en: "MEMORY",
    number: "04",
    pages: ["knowledge"],
  },
  {
    key: "models",
    label: "系统",
    en: "SYSTEM",
    number: "05",
    pages: ["models", "connect"],
  },
];
const activeGroup = computed(
  () => navigation.find((n) => n.pages.includes(studio.page)) || navigation[0],
);
const subtitles: Record<string, string> = {
  overview: "把日常连成故事。",
  live: "现场",
  spaces: "会话设置",
  lab: "历史回放",
  her: "记得昨天的自己，也成为今天的自己。",
  knowledge: "她记得的事，和她读过的资料。",
  models: "模型",
  connect: "QQ 连接",
};
const dateLabel = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
}).format(new Date());
const quietMotion = ref(localStorage.luckyQuietMotion === "true");
function toggleMotion() {
  quietMotion.value = !quietMotion.value;
  localStorage.luckyQuietMotion = String(quietMotion.value);
}
function movePointer(event: PointerEvent) {
  const halo = document.getElementById("pointerHalo");
  if (!halo || quietMotion.value || event.pointerType !== "mouse") return;
  halo.classList.add("visible");
  halo.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  halo.classList.toggle(
    "over-control",
    !!(event.target as HTMLElement).closest("button,a,summary,input,select"),
  );
}
function reloadPage() {
  window.location.reload();
}
function onHash() {
  const next = pageFromHash();
  if (!next) return;
  studio.page = next;
  if (location.hash.slice(1) !== next)
    history.replaceState(null, "", "#" + next);
}

onMounted(async () => {
  onHash();
  window.addEventListener("hashchange", onHash);
  window.addEventListener("pointermove", movePointer, { passive: true });
  try {
    await reload();
  } catch (e) {
    studio.error = (e as Error).message;
  }
  subscribe(async () => {
    if (!studio.dirty && studio.page !== "live") {
      try {
        await reload();
      } catch {
        /* keep last good snapshot */
      }
    }
  });
});
onUnmounted(() => {
  window.removeEventListener("hashchange", onHash);
  window.removeEventListener("pointermove", movePointer);
});

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
    <span class="eyebrow">OFFLINE / 暂未连接</span>
    <h1>LuckyBot 正在等你</h1>
    <p>{{ studio.error }}</p>
    <button class="primary" @click="reloadPage">重新连接 ↗</button>
  </div>
  <div
    v-else-if="studio.core && studio.health"
    class="studio"
    :class="{
      'quiet-motion': quietMotion,
      'document-page': studio.page === 'her',
    }"
  >
    <a class="skip-link" href="#mainContent">跳到主要内容</a>
    <div id="pointerHalo" aria-hidden="true"><span>✦</span></div>
    <aside class="sidebar">
      <a class="brand" href="#overview" @click.prevent="go('overview')"
        >Lucky<span>Bot</span><i>✦</i></a
      >
      <div class="brand-caption">THE EVERYDAY CONNECTION</div>
      <nav class="primary-nav" aria-label="主要功能">
        <button
          v-for="item in navigation"
          :key="item.key"
          :data-page="item.key"
          :class="{ active: activeGroup.key === item.key }"
          :aria-current="activeGroup.key === item.key ? 'page' : undefined"
          @click="go(item.key)"
        >
          <span class="nav-number">{{ item.number }}</span
          ><span class="nav-name"
            >{{ item.label }}<small>{{ item.en }}</small></span
          ><span class="nav-arrow">↗</span>
        </button>
      </nav>
      <div class="rail-art" aria-hidden="true">
        <span class="rail-orbit"></span><b>LIVE<br />YOUR<br /><em>LINK.</em></b
        ><i>✦</i>
      </div>
      <div class="sidebar-bottom">
        <button @click="toggleMotion" :aria-pressed="quietMotion">
          {{ quietMotion ? "开启灵动效果" : "减少动画" }} <span>◌</span></button
        ><a href="/guide.html" target="_blank" rel="noopener">使用教程 ↗</a
        ><span class="rail-version">LOCAL FIRST / LUCKYBOT</span>
      </div>
    </aside>
    <main id="mainContent" tabindex="-1">
      <header class="workspace-header">
        <div class="page-heading">
          <span class="chapter-index">{{ activeGroup.number }}</span>
          <div>
            <div class="eyebrow">{{ activeGroup.en }} / LUCKYBOT</div>
            <h1>{{ activeGroup.label }}<span class="heading-slash">/</span></h1>
          </div>
        </div>
        <div class="header-actions">
          <span class="date-label">{{ dateLabel }}</span
          ><span
            class="pill"
            :class="{ offline: !studio.health.connection.online }"
            id="connection"
            ><i></i
            >{{
              studio.health.connection.online ? "QQ 已连接" : "QQ 未连接"
            }}</span
          ><button id="refresh" @click="refresh" aria-label="刷新当前数据">
            ↻
          </button>
        </div>
      </header>
      <nav
        v-if="activeGroup.pages.length > 1"
        class="workspace-tabs"
        aria-label="工作区分区"
      >
        <button
          v-for="key in activeGroup.pages"
          :key="key"
          :data-page="key"
          :class="{ active: studio.page === key }"
          :aria-current="studio.page === key ? 'page' : undefined"
          @click="go(key)"
        >
          {{ subtitles[key] }}<span>↗</span>
        </button>
      </nav>
      <div v-if="studio.dirty" class="draft-banner" role="status">
        ● 草稿尚未保存 · 保存后才会应用到聊天
      </div>
      <Transition name="scene" mode="out-in"
        ><div
          :key="studio.page"
          class="page-content"
          :class="'page-' + studio.page"
        >
          <component :is="views[studio.page]" /></div
      ></Transition>
      <footer class="workspace-footer">
        <span>EVERY CONNECTION COUNTS</span
        ><span>LUCKYBOT <b>✦</b> {{ subtitles[studio.page] }}</span>
      </footer>
    </main>
  </div>
  <div v-else class="startup" role="status">
    <div class="loading-orbit"></div>
    <h1>正在进入 LuckyBot</h1>
    <p>连接你的会话与记忆…</p>
  </div>
</template>
