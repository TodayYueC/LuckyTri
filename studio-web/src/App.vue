<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { followHash, go, reload, studio } from "./stores/studio";
import { presence, refreshPresence, watchPresence } from "./stores/presence";
import { AREAS, MOBILE_MORE, MOBILE_TABS, NAV, type Page } from "./router";
import { subscribe } from "./sse";
import { toast } from "./api";
import { applyTheme, liveMood, setQuiet, theme } from "./mood/useMood";
import { loadWallpapers } from "./wallpaper";
import { MOODS } from "./mood/themes";
import { ACTIVITY_LABELS } from "./mood/presence";
import MoodSky from "./components/sky/MoodSky.vue";
import TaOrb from "./components/ta/TaOrb.vue";
import TaCompanion from "./components/ta/TaCompanion.vue";
import ThemePicker from "./components/shell/ThemePicker.vue";
import NowStatusDock from "./components/shell/NowStatusDock.vue";
import Confirm from "./components/ui/Confirm.vue";
import Icon from "./components/ui/Icon.vue";
import Sheet from "./components/ui/Sheet.vue";
import NowPage from "./pages/now/NowPage.vue";
import ChatsPage from "./pages/chats/ChatsPage.vue";
import HeartPage from "./pages/heart/HeartPage.vue";
import PeoplePage from "./pages/people/PeoplePage.vue";
import LifePage from "./pages/life/LifePage.vue";
import MemoryPage from "./pages/memory/MemoryPage.vue";
import NaturePage from "./pages/nature/NaturePage.vue";
import SystemPage from "./pages/system/SystemPage.vue";

const views: Record<Page, object> = {
  now: NowPage,
  chats: ChatsPage,
  heart: HeartPage,
  people: PeoplePage,
  life: LifePage,
  memory: MemoryPage,
  nature: NaturePage,
  system: SystemPage,
};

applyTheme();

const area = computed(() => AREAS[studio.page]);
const online = computed(() => Boolean(studio.health?.connection?.online));
const name = computed(
  () => presence.data?.name || studio.core?.nature?.name || "TA",
);
const activity = computed(() => presence.data?.activity?.kind || "idle");
const moreActive = computed(() => MOBILE_MORE.includes(studio.page));

let presenceTimer = 0;
let reloadTimer = 0;
let pulseTimer = 0;
let lastPresence = 0;

// Server changes arrive in bursts; each follower gets its own pace.
function onServerChange() {
  const now = Date.now();
  clearTimeout(presenceTimer);
  presenceTimer = window.setTimeout(
    () => {
      lastPresence = Date.now();
      refreshPresence();
    },
    now - lastPresence > 2000 ? 0 : 1200,
  );
  if (!studio.dirty && studio.page !== "chats") {
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => reload().catch(() => {}), 1200);
  }
  if (!pulseTimer)
    pulseTimer = window.setTimeout(() => {
      pulseTimer = 0;
      studio.pulse += 1;
    }, 3000);
}

async function refresh() {
  if (studio.dirty) {
    toast("请先保存草稿");
    return;
  }
  await Promise.all([reload(), refreshPresence()]);
  studio.tick += 1;
}

function focusMain() {
  document.getElementById("main")?.focus();
}

function reloadPage() {
  window.location.reload();
}

onMounted(async () => {
  void loadWallpapers();
  followHash();
  window.addEventListener("hashchange", followHash);
  window.addEventListener("popstate", followHash);
  try {
    await reload();
  } catch (error) {
    studio.error = (error as Error).message;
    return;
  }
  watchPresence();
  subscribe(onServerChange);
});

onUnmounted(() => {
  window.removeEventListener("hashchange", followHash);
  window.removeEventListener("popstate", followHash);
});
</script>

<template>
  <MoodSky />
  <div v-if="studio.error" class="startup">
    <TaOrb mood="blue" :size="128" />
    <span class="eyebrow">暂未连接</span>
    <h1>TA 在等你回来</h1>
    <p>{{ studio.error }}</p>
    <button class="primary" @click="reloadPage">重新连接</button>
  </div>
  <div
    v-else-if="studio.core && studio.health"
    class="shell"
    :class="'at-' + studio.page"
  >
    <a class="skip-link" href="#main" @click.prevent="focusMain"
      >跳到主要内容</a
    >
    <nav class="dock primary-nav" aria-label="主要功能">
      <button
        class="dock-ta"
        data-page="now"
        :class="{ active: studio.page === 'now' }"
        :aria-current="studio.page === 'now' ? 'page' : undefined"
        :aria-label="`${name}：回到此刻`"
        @click="go('now')"
      >
        <TaOrb :mood="liveMood" :activity="activity" :size="50" />
        <span class="dock-ta-text rail-label">
          <b>LuckyTri</b>
          <small
            >{{ name !== "LuckyTri" ? name + " · " : ""
            }}{{ MOODS[liveMood].label }} ·
            {{ ACTIVITY_LABELS[activity] || "闲着" }}</small
          >
        </span>
      </button>
      <div class="dock-groups">
        <section v-for="group in NAV" :key="group.label" class="dock-group">
          <h2 class="rail-label">{{ group.label }}</h2>
          <button
            v-for="key in group.pages"
            :key="key"
            class="dock-link"
            :data-page="key"
            :class="{ active: studio.page === key }"
            :aria-current="studio.page === key ? 'page' : undefined"
            :title="AREAS[key].label"
            @click="go(key)"
          >
            <Icon :name="key" />
            <span class="rail-label">{{ AREAS[key].label }}</span>
          </button>
        </section>
      </div>
      <div class="dock-foot">
        <ThemePicker />
        <button
          class="dock-tool"
          :aria-pressed="theme.quiet"
          :title="theme.quiet ? '开启灵动效果' : '减少动画'"
          @click="setQuiet(!theme.quiet)"
        >
          <Icon name="motion" />
          <span class="rail-label">{{
            theme.quiet ? "开启灵动效果" : "减少动画"
          }}</span>
        </button>
        <a
          class="dock-tool"
          href="/guide.html"
          target="_blank"
          rel="noopener"
          title="使用教程"
        >
          <Icon name="guide" />
          <span class="rail-label">使用教程 ↗</span>
        </a>
      </div>
    </nav>

    <div class="workspace">
    <NowStatusDock />

    <main id="main" tabindex="-1">
      <header class="topbar">
        <div class="topbar-title">
          <span class="eyebrow">{{ area.en }}</span>
          <h1>{{ area.label }}</h1>
          <p>{{ area.tagline }}</p>
        </div>
        <div class="topbar-actions">
          <button
            id="connection"
            class="pill"
            :class="{ offline: !online }"
            :title="online ? 'QQ 已连接' : '去连接 QQ'"
            @click="online || go('system', 'connect')"
          >
            <span class="dot" :class="{ off: !online }"></span
            >{{ online ? "QQ 已连接" : "QQ 未连接" }}
          </button>
          <button
            id="refresh"
            class="icon-button"
            aria-label="刷新当前数据"
            title="刷新"
            @click="refresh"
          >
            <Icon name="refresh" />
          </button>
        </div>
      </header>
      <div v-if="studio.dirty" class="draft-banner" role="status">
        <span class="dot warn"></span>草稿还没保存，保存后才会生效
      </div>
      <Transition name="scene" mode="out-in">
        <div :key="studio.page" class="view" :class="'page-' + studio.page">
          <component :is="views[studio.page]" />
        </div>
      </Transition>
    </main>
    </div>

    <nav class="tabbar" aria-label="主要功能">
      <button
        v-for="key in MOBILE_TABS"
        :key="key"
        :data-page="key"
        :class="{ active: studio.page === key }"
        :aria-current="studio.page === key ? 'page' : undefined"
        @click="go(key)"
      >
        <Icon :name="key" />
        <span>{{ AREAS[key].label }}</span>
      </button>
      <button
        class="tabbar-more"
        :class="{ active: moreActive }"
        :aria-expanded="studio.moreOpen"
        @click="studio.moreOpen = !studio.moreOpen"
      >
        <Icon name="more" />
        <span>更多</span>
      </button>
    </nav>
    <Sheet
      :open="studio.moreOpen"
      title="更多"
      eyebrow="更多"
      width="420px"
      @close="studio.moreOpen = false"
    >
      <div class="more-grid">
        <button
          v-for="key in MOBILE_MORE"
          :key="key"
          :data-page="key"
          :class="{ active: studio.page === key }"
          @click="go(key)"
        >
          <Icon :name="key" />
          <b>{{ AREAS[key].label }}</b>
          <small>{{ AREAS[key].tagline }}</small>
        </button>
      </div>
      <h3 class="more-title">界面主题</h3>
      <ThemePicker inline />
      <div class="row more-tools">
        <button :aria-pressed="theme.quiet" @click="setQuiet(!theme.quiet)">
          {{ theme.quiet ? "开启灵动效果" : "减少动画" }}
        </button>
        <a href="/guide.html" target="_blank" rel="noopener">使用教程 ↗</a>
      </div>
    </Sheet>

    <TaCompanion :hide-orb="studio.page === 'now'" />
  </div>
  <div v-else class="startup" role="status">
    <TaOrb :mood="liveMood" activity="idle" :size="128" />
    <h1>正在进入 TA 的小世界</h1>
    <p>连接会话与记忆…</p>
  </div>
  <Confirm />
</template>

<style scoped>
.startup {
  position: relative;
  z-index: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  min-height: 100dvh;
  padding: 24px;
  text-align: center;
}
.startup h1 {
  font-size: 26px;
}
.startup p {
  color: var(--ink-soft);
}
.shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--dock-w) minmax(0, 1fr);
  min-height: 100dvh;
}
.skip-link {
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 120;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  transform: translateY(-160%);
  transition: transform 0.2s;
}
.skip-link:focus {
  transform: none;
}

/* ---------- dock ---------- */
.dock {
  position: sticky;
  top: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: calc(100dvh - 28px);
  margin: 14px 0 14px 14px;
  padding: 14px 12px;
  border-radius: 34px;
  background:
    linear-gradient(
      180deg,
      rgb(255 255 255 / 0.72),
      rgb(255 255 255 / 0.14) 46%,
      transparent 78%
    ),
    var(--surface);
  color: var(--ink);
  border: 1px solid var(--glass-edge);
  box-shadow:
    inset 1px 1px 0 rgb(255 255 255 / 0.9),
    0 22px 60px -34px rgb(69 94 148 / 0.34);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur))
    saturate(var(--glass-saturate));
  overflow-y: auto;
  overflow-x: hidden;
}
.dock-ta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 4px;
  border: none;
  border-radius: 22px;
  background: transparent;
  text-align: left;
}
.dock-ta:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  transform: none;
  box-shadow: none;
}
.dock-ta.active {
  background: var(--accent-soft);
}
.dock-ta-text {
  display: grid;
  min-width: 0;
  line-height: 1.3;
}
.dock-ta-text b {
  overflow: hidden;
  font: 700 16px var(--font-display);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-ta-text small {
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dock-groups {
  display: grid;
  gap: 14px;
}
.dock-group {
  display: grid;
  gap: 2px;
}
.dock-group h2 {
  padding: 0 12px 4px;
  font: 700 10.5px/1.4 var(--font-display);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.dock-link,
.dock-tool {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  text-align: left;
}
.dock-tool {
  padding: 8px 12px;
  font-size: 13px;
}
.dock-link:hover:not(:disabled),
.dock-tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.dock-link.active {
  background: linear-gradient(
    110deg,
    rgb(255 255 255 / 0.92),
    color-mix(in srgb, var(--glow-a) 44%, white)
  );
  color: var(--accent);
  box-shadow:
    inset 0 1px 0 white,
    0 9px 22px -14px var(--accent);
}
.dock-link.active::after {
  content: "";
  width: 7px;
  height: 7px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
}
.dock-foot {
  display: grid;
  gap: 2px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

/* ---------- main ---------- */
main {
  min-width: 0;
  padding-bottom: 32px;
  outline: none;
}
.topbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  width: min(1232px, calc(100% - 36px));
  margin: 16px auto 8px;
  padding: 16px 22px;
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.72), transparent 70%),
    var(--surface);
  border: 1px solid var(--glass-edge);
  box-shadow:
    inset 0 1px 0 white,
    0 16px 38px -28px rgb(69 94 148 / 0.3);
  backdrop-filter: blur(18px) saturate(1.5);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
}
.topbar h1 {
  font-family: var(--font-display);
  font-size: 29px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.topbar p {
  margin-top: 2px;
  color: var(--ink-soft);
  font-size: 13.5px;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
#connection {
  padding: 7px 14px;
}
#connection.offline {
  cursor: pointer;
}
.draft-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(1224px, calc(100% - 56px));
  margin: 0 auto 14px;
  padding: 9px 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warn) 12%, var(--surface-strong));
  border: 1px solid color-mix(in srgb, var(--warn) 28%, transparent);
  font-size: 13px;
  font-weight: 600;
}
.at-now .topbar-title p {
  display: block;
}

/* The chat page owns the full height; its panes scroll on their own. */
.at-chats main {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding-bottom: 16px;
  overflow: hidden;
}
.at-chats .view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ---------- phone tab bar ---------- */
.tabbar {
  display: none;
}
.more-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.more-grid button {
  display: grid;
  justify-items: start;
  gap: 4px;
  padding: 14px;
  border-radius: 18px;
  text-align: left;
}
.more-grid button.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.more-grid small {
  color: var(--ink-soft);
  font-size: 11.5px;
  font-weight: 500;
}
.more-title {
  margin: 20px 0 8px;
  font-size: 14px;
}
.more-tools {
  margin-top: 14px;
}

@media (max-width: 1100px) and (min-width: 761px) {
  .shell {
    grid-template-columns: 92px minmax(0, 1fr);
  }
  .dock {
    align-items: center;
    padding: 14px 8px;
  }
  .dock-ta {
    padding: 4px;
  }
  .dock-link,
  .dock-tool {
    justify-content: center;
    width: 52px;
    padding: 12px 0;
  }
  .dock-group {
    justify-items: center;
  }
  .dock-foot {
    justify-items: center;
  }
  .dock :deep(.theme-toggle) {
    justify-content: center;
    width: 52px;
    padding: 10px 0;
  }
  .dock-link.active::after {
    display: none;
  }
  .rail-label,
  .dock :deep(.rail-label) {
    position: absolute !important;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}

@media (max-width: 760px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }
  .dock {
    display: none;
  }
  main {
    padding-bottom: calc(128px + env(safe-area-inset-bottom));
  }
  .topbar {
    align-items: center;
    padding: 16px 14px 12px;
  }
  .topbar h1 {
    font-size: 22px;
  }
  .topbar p {
    display: none;
  }
  .draft-banner {
    width: calc(100% - 28px);
  }
  .at-chats main {
    display: block;
    height: auto;
    overflow: visible;
    padding-bottom: calc(96px + env(safe-area-inset-bottom));
  }
  .tabbar {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    z-index: 65;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 2px;
    padding: 6px;
    border-radius: 24px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, white 34%, transparent),
        transparent 70%
      ),
      var(--surface);
    border: 1px solid var(--glass-edge);
    box-shadow: var(--glass-sheen), var(--shadow);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur))
      saturate(var(--glass-saturate));
  }
  .tabbar button {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 7px 0 6px;
    border: none;
    border-radius: 18px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 11px;
  }
  .tabbar button:hover:not(:disabled) {
    transform: none;
    box-shadow: none;
  }
  .tabbar button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
}

/* A floating lens replaces the old application rail. The same page buttons
   remain in place, so navigation and keyboard behaviour stay unchanged. */
@media (min-width: 761px) {
  .shell {
    display: block;
    padding-top: 1px;
  }
  .dock {
    position: sticky;
    top: 14px;
    z-index: 66;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    width: min(1460px, calc(100% - 40px));
    height: auto;
    min-height: 72px;
    margin: 14px auto 0;
    padding: 8px 12px;
    border-radius: 999px;
    overflow: visible;
    background:
      radial-gradient(
        ellipse at 12% -80%,
        rgb(255 255 255 / 0.94),
        transparent 58%
      ),
      linear-gradient(
        110deg,
        rgb(255 255 255 / 0.78),
        rgb(242 246 255 / 0.61) 52%,
        rgb(255 255 255 / 0.78)
      ),
      color-mix(in srgb, var(--sky-mid) 82%, white);
    border: 1.5px solid rgb(255 255 255 / 0.83);
    box-shadow:
      inset 0 2px 1px white,
      inset 0 -2px 2px rgb(112 143 210 / 0.13),
      0 22px 44px -28px rgb(52 82 149 / 0.38);
  }
  .dock-ta {
    flex: none;
    min-width: 160px;
    border: 1px solid transparent;
    padding: 4px 12px 4px 4px;
    border-radius: 999px;
  }
  .dock-ta.active,
  .dock-ta:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.42);
    border-color: rgb(255 255 255 / 0.77);
    box-shadow:
      inset 0 1px 0 white,
      0 8px 17px -14px var(--accent);
    transform: translateY(-2px) scale(1.02);
  }
  .dock-groups {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }
  .dock-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .dock-group h2 {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .dock-link {
    position: relative;
    width: auto;
    min-height: 45px;
    justify-content: center;
    gap: 7px;
    padding: 9px 12px;
    border: 1px solid transparent;
    border-radius: 999px;
    white-space: nowrap;
  }
  .dock-link:hover:not(:disabled) {
    transform: translateY(-3px) scale(1.045);
    background: rgb(255 255 255 / 0.52);
    border-color: rgb(255 255 255 / 0.75);
    box-shadow: 0 12px 18px -14px var(--accent);
  }
  .dock-link.active {
    color: var(--ink);
    background: linear-gradient(
      120deg,
      rgb(255 255 255 / 0.98),
      color-mix(in srgb, var(--glow-a) 40%, white) 64%,
      color-mix(in srgb, var(--glow-b) 28%, white)
    );
    border-color: rgb(255 255 255 / 0.97);
    box-shadow:
      inset 0 1px 0 white,
      0 8px 19px -13px var(--accent);
    animation: dock-bloom 560ms var(--spring) both;
  }
  .dock-link.active::after {
    display: none;
  }
  .dock-foot {
    display: flex;
    flex: none;
    align-items: center;
    gap: 3px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .dock-tool,
  .dock :deep(.theme-toggle) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    padding: 0;
    border-radius: 50%;
  }
  .dock-tool .rail-label,
  .dock :deep(.theme-toggle .rail-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .dock-tool:hover:not(:disabled),
  .dock :deep(.theme-toggle:hover:not(:disabled)) {
    transform: translateY(-3px) scale(1.08);
    background: rgb(255 255 255 / 0.62);
    box-shadow:
      inset 0 1px white,
      0 11px 17px -13px var(--accent);
  }
  main {
    width: 100%;
  }
  .workspace {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 22px;
    align-items: start;
    width: min(1480px, calc(100% - 36px));
    margin: 8px auto 0;
  }
  .workspace > main {
    width: auto;
    min-width: 0;
  }
  .workspace .topbar {
    align-items: center;
    width: calc(100% - 56px);
    margin: 14px 28px 6px;
    padding: 4px 22px 8px;
    border: none;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .topbar h1 {
    font-size: clamp(28px, 2.8vw, 38px);
    font-weight: 760;
  }
}
@keyframes dock-bloom {
  from {
    transform: scale(0.88) translateY(4px);
    filter: brightness(1.15);
  }
  to {
    transform: scale(1) translateY(0);
    filter: brightness(1);
  }
}
@media (min-width: 761px) and (max-width: 1100px) {
  .dock {
    gap: 6px;
    padding-inline: 9px;
  }
  .dock-ta {
    min-width: 145px;
  }
  .dock-ta-text.rail-label {
    position: static !important;
    display: grid;
    width: auto;
    height: auto;
    clip: auto;
  }
  .dock-ta-text small {
    display: none;
  }
  .dock-link {
    width: 42px;
    min-width: 42px;
    padding: 10px;
  }
  .dock-tool,
  .dock :deep(.theme-toggle) {
    width: 38px;
    height: 38px;
  }
}
@media (max-width: 760px) {
  .workspace {
    display: block;
    width: 100%;
    margin: 0;
  }
  .topbar {
    width: calc(100% - 28px);
    margin-top: 14px;
    padding: 8px 5px 10px;
    border: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }
  .tabbar {
    border: 1.5px solid rgb(255 255 255 / 0.86);
    background:
      linear-gradient(
        130deg,
        rgb(255 255 255 / 0.77),
        rgb(255 255 255 / 0.27) 57%,
        rgb(230 236 255 / 0.55)
      ),
      var(--glass-fill);
    box-shadow:
      inset 0 2px 1px white,
      0 20px 38px -24px rgb(52 82 149 / 0.44);
  }
  .tabbar button.active {
    background: linear-gradient(
      130deg,
      white,
      color-mix(in srgb, var(--glow-a) 40%, white)
    );
    border: 1px solid white;
    box-shadow: 0 6px 15px -10px var(--accent);
    animation: dock-bloom 480ms var(--spring) both;
  }
}
</style>
