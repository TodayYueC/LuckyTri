<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { locale, t } from "../../i18n";
import { go, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { AREAS, type Page } from "../../router";
import {
  PRIMARY,
  LIFE_SECTIONS,
  MEMORY_SECTIONS,
  primaryFor,
  lifeSection,
  memorySection,
  type Destination,
  type Primary,
} from "../../navigation";
import { liveMood, setQuiet, theme } from "../../mood/useMood";
import { ACTIVITY_LABELS } from "../../mood/presence";
import { views, preloadPage } from "../../pages";
import Icon from "../ui/Icon.vue";
import Tabs from "../ui/SectionNav.vue";
import Popover from "../ui/Popover.vue";
import Sheet from "../ui/Sheet.vue";
import TaOrb from "../ta/TaOrb.vue";
import TaCompanion from "../ta/TaCompanion.vue";
import ThemePicker from "./ThemePicker.vue";
import LocaleSwitch from "./LocaleSwitch.vue";
import NowStatusDock from "./NowStatusDock.vue";
import HomeLayoutPicker from "../../pages/now/HomeLayoutPicker.vue";
import WallpaperPicker from "../../pages/now/WallpaperPicker.vue";

defineProps<{ refreshing: boolean }>();
const emit = defineEmits<{ refresh: [] }>();
const selected = computed(() => primaryFor(studio.page, studio.sub));
const title = computed(
  () =>
    PRIMARY.find((item) => item.key === selected.value)?.label ||
    AREAS[studio.page].label,
);
const name = computed(
  () => presence.data?.name || studio.core?.nature?.name || "TA",
);
const activity = computed(() => presence.data?.activity?.kind || "idle");
const online = computed(() => Boolean(studio.health?.connection?.online));
const popups = reactive({
  status: false,
  appearance: false,
  connection: false,
  settings: false,
});
const wallpaperOpen = ref(false);
const nav = ref<HTMLElement>();
const content = ref<HTMLElement>();
const scrollPositions = new Map<string, number>();
watch(
  () => `${studio.page}/${studio.sub}`,
  async (key, old) => {
    if (old && content.value) scrollPositions.set(old, content.value.scrollTop);
    await nextTick();
    if (content.value) content.value.scrollTop = scrollPositions.get(key) || 0;
  },
  { flush: "pre" },
);
const indicator = ref({
  height: "46px",
  width: "0px",
  transform: "translateX(0px)",
  opacity: "0",
});
const remembered = new Map<Primary, Destination>();
const groups = computed(() =>
  selected.value === "life"
    ? LIFE_SECTIONS
    : selected.value === "memory"
      ? MEMORY_SECTIONS
      : [],
);
const section = computed(() =>
  selected.value === "life"
    ? lifeSection(studio.page, studio.sub)
    : memorySection(studio.page, studio.sub),
);
watch(
  () => studio.chatOpen,
  (open) => {
    if (open) closePopups();
  },
);
const guide = computed(() =>
  locale.value === "en" ? "/guide.en.html" : "/guide.html",
);

function closePopups() {
  Object.keys(popups).forEach((key) => {
    popups[key as keyof typeof popups] = false;
  });
}
async function navigate(page: Page, sub = "") {
  closePopups();
  await go(page, sub);
}
async function primary(key: Primary) {
  if (selected.value === key) return;
  const last = remembered.get(key) || {
    page: key === "life" ? "time" : key,
    sub: "",
  };
  await navigate(last.page, last.sub);
}
function switchSection(key: string) {
  const next = groups.value.find((item) => item.key === key);
  if (next) void navigate(next.page, next.sub);
}
function moveIndicator() {
  const button = nav.value?.querySelector<HTMLElement>('[aria-current="page"]');
  indicator.value = button
    ? {
        height: `${button.offsetHeight}px`,
        width: `${button.offsetWidth}px`,
        transform: `translate(${button.offsetLeft}px, ${button.offsetTop}px)`,
        opacity: "1",
      }
    : { ...indicator.value, opacity: "0" };
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(moveIndicator);
  if (nav.value) observer.observe(nav.value);
  void nextTick(moveIndicator);
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => [studio.page, studio.sub],
  async () => {
    const key = selected.value;
    if (key !== "settings")
      remembered.set(key, { page: studio.page, sub: studio.sub });
    closePopups();
    await nextTick();
    moveIndicator();
  },
  { immediate: true },
);
watch(locale, () => nextTick(moveIndicator));
function focusMain() {
  document.getElementById("main")?.focus();
}
function wallpaper() {
  closePopups();
  wallpaperOpen.value = true;
}
</script>

<template>
  <div class="shell studio-shell" :class="'at-' + studio.page">
    <a class="skip-link" href="#main" @click.prevent="focusMain">{{
      t("跳到主要内容")
    }}</a>
    <header class="studio-header">
      <button class="studio-brand" @click="primary('now')">
        <Icon name="heart" /><span>LuckyTri</span>
      </button>
      <h1 class="studio-page-title">{{ title }}</h1>
      <div class="studio-presence">
        <Popover
          control="status"
          v-model="popups.status"
          :title="t('TA 的此刻状态')"
          :width="390"
        >
          <template #trigger
            ><TaOrb :mood="liveMood" :activity="activity" :size="28" /><span
              class="presence-caption"
              >{{ name }} · {{ ACTIVITY_LABELS[activity] || t("闲着") }}</span
            ></template
          >
          <NowStatusDock />
        </Popover>
      </div>
      <div class="studio-controls">
        <HomeLayoutPicker v-if="studio.page === 'now'" />
        <Popover
          control="appearance"
          v-model="popups.appearance"
          :title="t('外观与语言')"
          :width="360"
        >
          <template #trigger><Icon name="palette" /></template>
          <div class="control-row">
            <span>{{ t("语言") }}</span
            ><LocaleSwitch />
          </div>
          <div class="control-row">
            <label for="studio-motion">{{ t("减少动画") }}</label
            ><input
              id="studio-motion"
              type="checkbox"
              class="control-switch"
              :checked="theme.quiet"
              @change="setQuiet(($event.target as HTMLInputElement).checked)"
            />
          </div>
          <h3 class="control-section-title">{{ t("界面主题") }}</h3>
          <ThemePicker inline />
          <button class="control-menu-item" @click="wallpaper">
            <Icon name="palette" /><span>{{ t("壁纸与构图") }}</span>
          </button>
        </Popover>
        <Popover
          control="connection"
          v-model="popups.connection"
          :title="t('连接与状态')"
          :width="320"
        >
          <template #trigger
            ><span class="dot" :class="{ off: !online }"></span
            ><span class="connection-caption">{{
              online ? t("已连接") : t("未连接")
            }}</span></template
          >
          <div class="control-row">
            <span>{{ t("QQ 连接") }}</span
            ><span>{{ online ? t("QQ 已连接") : t("QQ 未连接") }}</span>
          </div>
          <button
            id="refresh"
            class="control-menu-item"
            :disabled="refreshing"
            @click="emit('refresh')"
          >
            <Icon name="refresh" /><span>{{
              refreshing ? t("正在刷新…") : t("刷新当前数据")
            }}</span>
          </button>
          <button
            id="connection"
            class="control-menu-item"
            @click="navigate('system', 'connect')"
          >
            <Icon name="system" /><span>{{ t("连接设置") }}</span>
          </button>
        </Popover>
        <Popover
          control="settings"
          v-model="popups.settings"
          :title="t('设置')"
          :width="300"
        >
          <template #trigger><Icon name="system" /></template>
          <button
            class="control-menu-item"
            data-page="nature"
            @click="navigate('nature')"
          >
            <Icon name="nature" /><span
              >{{ t("角色天性")
              }}<small>{{ t("名字、性格、边界与作息") }}</small></span
            >
          </button>
          <button
            class="control-menu-item"
            data-page="system"
            @click="navigate('system', 'connect')"
          >
            <Icon name="system" /><span
              >{{ t("连接与模型")
              }}<small>{{ t("QQ、模型、语音与媒体") }}</small></span
            >
          </button>
          <button
            class="control-menu-item"
            data-page="plugins"
            @click="navigate('plugins')"
          >
            <Icon name="plugins" /><span
              >{{ t("插件与权限")
              }}<small>{{ t("能力扩展与待处理请求") }}</small></span
            >
          </button>
          <button
            class="control-menu-item"
            @click="navigate('system', 'storage')"
          >
            <Icon name="memory" /><span>{{ t("数据与备份") }}</span>
          </button>
          <a
            class="control-menu-item"
            :href="guide"
            target="_blank"
            rel="noopener"
            ><Icon name="guide" /><span>{{ t("使用教程 ↗") }}</span></a
          >
        </Popover>
      </div>
    </header>
    <main id="main" class="studio-main" tabindex="-1">
      <div v-if="studio.dirty" class="draft-banner" role="status">
        {{ t("草稿还没保存，保存后才会生效") }}
      </div>
      <Tabs
        v-if="groups.length"
        class="workspace-tabs"
        :model-value="section"
        :items="groups"
        :label="selected === 'life' ? t('生活的分区') : t('记忆的分区')"
        @update:model-value="switchSection"
      />
      <div ref="content" class="view" :class="'page-' + studio.page">
        <KeepAlive
          :max="5"
          :include="[
            'NowPage',
            'HeartPage',
            'PeoplePage',
            'LifePage',
            'TimePage',
          ]"
          ><component
            :is="views[studio.page]"
            :key="studio.page"
            class="route-page"
        /></KeepAlive>
      </div>
    </main>
    <div class="studio-navigation">
      <nav ref="nav" class="dock primary-nav" :aria-label="t('主要功能')">
        <span
          class="dock-selection"
          :style="indicator"
          aria-hidden="true"
        ></span
        ><button
          v-for="item in PRIMARY"
          :key="item.key"
          class="dock-link"
          :data-page="item.key"
          :aria-label="item.label"
          :class="{ active: selected === item.key }"
          :aria-current="selected === item.key ? 'page' : undefined"
          @click="primary(item.key)"
          @pointerenter="
            preloadPage(item.key === 'life' ? 'time' : item.key).catch(() => {})
          "
          @focus="
            preloadPage(item.key === 'life' ? 'time' : item.key).catch(() => {})
          "
        >
          <Icon :name="item.key" /><span>{{ item.label }}</span>
        </button>
      </nav>
    </div>
    <Sheet
      :open="wallpaperOpen"
      :title="t('壁纸与构图')"
      width="540px"
      @close="wallpaperOpen = false"
      ><WallpaperPicker open @close="wallpaperOpen = false"
    /></Sheet>
    <TaCompanion :hide-orb="studio.page === 'now'" />
  </div>
</template>
