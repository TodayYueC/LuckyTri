<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
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

const groups = [
  { label: "日常使用", items: ["overview", "live", "knowledge"] },
  { label: "角色与行为", items: ["character", "spaces"] },
  { label: "系统配置", items: ["models", "connect", "lab"] },
];
const descriptions: Record<string, string> = {
  overview: "连接、会话与最近动态，都在这里。",
  live: "看看大家正在聊什么，以及 LuckyBot 为什么回应。",
  knowledge: "按会话整理回忆，留住值得记住的事情。",
  character: "定义她是谁，再试试她会怎么说。",
  spaces: "选择参与哪些对话，分别调整聊天节奏。",
  models: "连接模型，设置思考能力与上下文容量。",
  connect: "从安装到登录，完成 QQ 连接。",
  lab: "查看处理过程，用历史消息验证回复效果。",
};
const marks: Record<string, string> = {
  overview: "01",
  live: "02",
  knowledge: "03",
  character: "04",
  spaces: "05",
  models: "06",
  connect: "07",
  lab: "08",
};
const quietMotion = ref(localStorage.luckyQuietMotion === "true");
function toggleMotion() {
  quietMotion.value = !quietMotion.value;
  localStorage.luckyQuietMotion = String(quietMotion.value);
}
function movePointer(event: PointerEvent) {
  const halo = document.getElementById("pointerHalo");
  if (!halo || event.pointerType !== "mouse") return;
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
  const next = location.hash.slice(1);
  if (Object.hasOwn(pages, next)) studio.page = next as keyof typeof pages;
}

onMounted(async () => {
  window.addEventListener("hashchange", onHash);
  window.addEventListener("pointermove", movePointer, { passive: true });
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
    <div class="eyebrow">CONNECTION</div>
    <h1>暂时无法连接工作室</h1>
    <p>{{ studio.error }}</p>
    <button class="primary" @click="reloadPage">重新连接</button>
  </div>
  <div
    v-else-if="studio.core && studio.health"
    class="studio"
    :class="{ 'quiet-motion': quietMotion }"
  >
    <div id="pointerHalo" aria-hidden="true"></div>
    <div class="ambient-orbit" aria-hidden="true"></div>
    <a class="skip-link" href="#mainContent">跳到主要内容</a>
    <aside class="sidebar">
      <a class="brand" href="#overview" @click.prevent="go('overview')"
        ><span class="brand-symbol">L<span>✦</span></span
        ><span>LuckyBot<small>让每一次相遇有回响</small></span></a
      >
      <nav aria-label="主导航">
        <div v-for="group in groups" :key="group.label" class="nav-group">
          <div class="nav-label">{{ group.label }}</div>
          <button
            v-for="key in group.items"
            :key="key"
            :data-page="key"
            :class="{ active: studio.page === key }"
            :aria-current="studio.page === key ? 'page' : undefined"
            @click="go(key)"
          >
            <span class="nav-number">{{ marks[key] }}</span
            ><span>{{ pages[key as keyof typeof pages] }}</span
            ><span class="nav-arrow">↗</span>
          </button>
        </div>
      </nav>
      <div class="sidebar-bottom">
        <span class="small">YOUR EVERYDAY COMPANION</span
        ><a href="/guide.html">使用教程 <span>↗</span></a
        ><button @click="toggleMotion" :aria-pressed="quietMotion">
          {{ quietMotion ? "开启灵动效果" : "减少动画" }}
        </button>
      </div>
    </aside>
    <main id="mainContent" tabindex="-1">
      <header class="workspace-header">
        <div>
          <div class="eyebrow">LUCKYBOT / {{ marks[studio.page] }}</div>
          <h1>{{ pages[studio.page] }}</h1>
          <p class="page-description">{{ descriptions[studio.page] }}</p>
        </div>
        <div class="header-actions">
          <span
            class="pill"
            :class="{ offline: !studio.health.connection.online }"
            id="connection"
            ><i></i
            >{{
              studio.health.connection.online ? "QQ 已连接" : "QQ 未连接"
            }}</span
          ><button id="refresh" @click="refresh" aria-label="刷新当前数据">
            ↻ 刷新
          </button>
        </div>
      </header>
      <div v-if="studio.dirty" class="draft-banner" role="status">
        有尚未保存的修改，请在当前页面保存后切换。
      </div>
      <Transition name="page" mode="out-in"
        ><div
          :key="studio.page"
          class="page-content"
          :class="'page-' + studio.page"
        >
          <component :is="views[studio.page]" /></div
      ></Transition>
      <footer class="workspace-footer">
        <span>LuckyBot · 日常，正在发生</span><span>LOCAL WORKSPACE / ✦</span>
      </footer>
    </main>
  </div>
  <div v-else class="startup" role="status">
    <div class="loading-orbit"></div>
    <h1>正在打开工作室</h1>
    <p>连接你的会话与记忆…</p>
  </div>
</template>
