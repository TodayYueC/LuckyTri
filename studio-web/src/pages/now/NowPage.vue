<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { go, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { liveMood } from "../../mood/useMood";
import {
  ANTICIPATION_LABELS,
  ANTICIPATION_STATES,
  CHOICE_LABELS,
  ORIGIN_LABELS,
  RUN_LABELS,
  RUN_STATES,
  mind,
} from "../../plates/mind";
import { ago, clockTime, dayLabel, num, placeName } from "../../format";
import { wallpapers } from "../../wallpaper";
import TaOrb from "../../components/ta/TaOrb.vue";
import Card from "../../components/ui/Card.vue";
import Empty from "../../components/ui/Empty.vue";
import Meter from "../../components/ui/Meter.vue";
import Tabs from "../../components/ui/Tabs.vue";
import Timeline from "../../components/ui/Timeline.vue";
import WallpaperPicker from "./WallpaperPicker.vue";
import { useHeroStage } from "./useHeroStage";

const overview = ref<any>(null);
const today = ref<any>(null);
const filter = ref("all");
const wallpaperPicking = ref(false);
const {
  adjusting,
  heroRef,
  imageRef,
  orbRef,
  pictureStyle,
  orbStyle,
  orbDragging,
  orbSize,
  beginOrbDrag,
  beginPictureDrag,
  movePicture,
  endPictureDrag,
  resetPicture,
  finishPicture,
} = useHeroStage();

const LEDGER = [
  { id: "conversation", label: "对话" },
  { id: "inner", label: "独处与日记" },
  { id: "upkeep", label: "整理记忆" },
];
const p = computed(() => presence.data);
const activity = computed(() => p.value?.activity?.kind || "idle");
const zone = computed(
  () =>
    p.value?.clock?.timeZone ||
    overview.value?.clock?.timeZone ||
    "Asia/Shanghai",
);
const speech = computed(() =>
  activity.value === "speaking" && p.value?.lastWords
    ? p.value.lastWords.text
    : "",
);
type Row = {
  id: string;
  time: number;
  tone?: string;
  type: string;
  [key: string]: any;
};
const rows = computed<Row[]>(() => {
  const items: any[] = today.value?.items || [];
  const out: Row[] = [];
  for (const [i, item] of items.entries()) {
    const kind =
      item.type === "choice" || item.type === "glance"
        ? "talk"
        : item.type === "feeling"
          ? "feel"
          : "inner";
    if (filter.value !== "all" && filter.value !== kind) continue;
    const last = out[out.length - 1];
    if (item.type === "glance" && last?.type === "glance") {
      last.count += 1;
      const label = placeName({ name: item.sessionName, id: item.session });
      if (!last.places.includes(label)) last.places.push(label);
      continue;
    }
    out.push({
      ...item,
      id: `${item.type}-${item.time}-${i}`,
      tone:
        item.type === "glance" ||
        (item.type === "choice" && item.choice === "silent")
          ? "quiet"
          : item.type === "feeling"
            ? item.valence >= 0
              ? "warm"
              : "night"
            : item.type === "run"
              ? "night"
              : "glow",
      count: 1,
      places:
        item.type === "glance"
          ? [placeName({ name: item.sessionName, id: item.session })]
          : [],
    });
  }
  return out;
});
const counts = computed(() => {
  const items: any[] = today.value?.items || [];
  return {
    all: items.length,
    talk: items.filter((i) => i.type === "choice" || i.type === "glance")
      .length,
    feel: items.filter((i) => i.type === "feeling").length,
    inner: items.filter((i) => i.type === "run" || i.type === "ahead").length,
  };
});
const usage = computed(() => overview.value?.budget?.usage || {});
const limits = computed(() => overview.value?.budget?.limits || {});

function share(id: string) {
  const limit = limits.value[id];
  if (limit) return (usage.value[id] || 0) / limit;
  return usage.value.total ? (usage.value[id] || 0) / usage.value.total : 0;
}

async function load() {
  const [o, t] = await Promise.all([mind.overview(), mind.today()]);
  overview.value = o;
  today.value = t;
}

onMounted(() => {
  void load();
});
watch(() => [studio.tick, studio.pulse], load);
</script>

<template>
  <div class="page now">
    <div class="now-presentation">
    <section ref="heroRef" class="now-hero" :class="{ 'wallpaper-adjusting': adjusting }">
      <div class="wallpaper-layer" aria-hidden="true">
        <img
          ref="imageRef"
          :src="wallpapers.hero"
          :style="pictureStyle"
          alt=""
          draggable="false"
        />
      </div>
      <div
        v-if="adjusting"
        class="wallpaper-drag-layer"
        role="application"
        aria-label="拖动调整首页壁纸构图"
        @pointerdown.prevent="beginPictureDrag"
        @pointermove.prevent="movePicture"
        @pointerup="endPictureDrag"
        @pointercancel="endPictureDrag"
        @lostpointercapture="endPictureDrag"
      >
        <span class="wallpaper-tip">按住并拖动图片，调整人物位置</span>
      </div>
      <div class="wallpaper-controls">
        <template v-if="adjusting">
          <span class="wallpaper-tip-inline">拖动背景调整构图</span>
          <button type="button" @click="resetPicture">恢复默认</button>
          <button type="button" class="primary" @click="finishPicture">
            完成
          </button>
        </template>
        <button v-else type="button" @click="adjusting = true">
          调整构图
        </button>
        <button
          v-if="!adjusting"
          type="button"
          @click="wallpaperPicking = !wallpaperPicking"
        >
          换壁纸
        </button>
      </div>
      <WallpaperPicker :open="wallpaperPicking && !adjusting" @close="wallpaperPicking = false" />
      <div class="stage">
        <div
          class="orb-anchor"
          :class="{ dragging: orbDragging }"
          :style="orbStyle"
          @pointerdown.capture="beginOrbDrag"
        >
          <span class="orb-aura" aria-hidden="true"></span>
          <span class="liquid-bloom b1" aria-hidden="true"></span>
          <span class="liquid-bloom b2" aria-hidden="true"></span>
          <span class="liquid-bloom b3" aria-hidden="true"></span>
          <span class="orb-ground-shadow" aria-hidden="true"></span>
          <div class="hero-orb">
          <TaOrb
            ref="orbRef"
            :mood="liveMood"
            :activity="activity"
            :size="orbSize"
            :speech="speech"
            interactive
            @open-chat="studio.chatOpen = true"
          />
          </div>
        </div>
      </div>
    </section>
    </div>

    <section class="notes">
      <article class="note words">
        <span class="eyebrow">TA 最近说</span>
        <template v-if="p?.lastWords">
          <p class="quote">“{{ p.lastWords.text }}”</p>
          <small
            >{{ placeName({ name: p.lastWords.sessionName, id: p.lastWords.session }) }} ·
            {{ ago(p.lastWords.time, p.now) }}</small
          >
        </template>
        <p v-else class="muted">TA 还没在哪里开过口。</p>
      </article>
      <article class="note thought">
        <span class="eyebrow">放在心上</span>
        <template v-if="p?.thought">
          <p>{{ p.thought.content }}</p>
          <small>{{ p.thought.when }}</small>
        </template>
        <p v-else class="muted">心里暂时没有挂着的事。</p>
        <button class="text-button" @click="go('heart', 'notes')">
          看看 TA 的便签
        </button>
      </article>
      <article class="note ahead">
        <span class="eyebrow">在等的事</span>
        <ul v-if="p?.expecting?.length" class="list">
          <li v-for="a in p.expecting" :key="a.id">
            <b>{{ a.when }}</b>
            <span>{{ a.name ? `${a.name}：` : "" }}{{ a.content }}</span>
            <small>{{ ANTICIPATION_LABELS[a.kind] || a.kind }}</small>
          </li>
        </ul>
        <p v-else class="muted">这几天没有 TA 特别在等的事。</p>
        <button class="text-button" @click="go('life', 'ahead')">
          约定与期待
        </button>
      </article>
    </section>

    <section class="now-grid">
      <Card
        class="today"
        title="今天的 TA"
        :sub="today ? `${dayLabel(today.day)}，按时间排在一起` : ''"
      >
        <template #actions>
          <Tabs
            v-model="filter"
            label="筛选今天的事"
            :items="[
              { key: 'all', label: '全部', count: counts.all },
              { key: 'talk', label: '开口与沉默', count: counts.talk },
              { key: 'feel', label: '心情', count: counts.feel },
              { key: 'inner', label: '独处与日记', count: counts.inner },
            ]"
          />
        </template>
        <div class="today-scroll scroll-pane">
          <Timeline v-if="rows.length" :items="rows" label="今天的 TA">
            <template #default="{ item }">
              <div class="entry-head">
                <time>{{ clockTime(item.time, zone) }}</time>
                <b v-if="item.type === 'choice'">{{
                  CHOICE_LABELS[item.choice] || item.choice
                }}</b>
                <b v-else-if="item.type === 'glance'"
                  >扫了{{ item.count > 1 ? ` ${item.count} ` : "一" }}眼</b
                >
                <b v-else-if="item.type === 'feeling'"
                  >心情 · {{ item.feeling }}</b
                >
                <b v-else-if="item.type === 'run'"
                  >{{ RUN_LABELS[item.kind] || item.kind }} ·
                  {{ RUN_STATES[item.status] || item.status }}</b
                >
                <b v-else
                  >约定 ·
                  {{ ANTICIPATION_STATES[item.status] || item.status }}</b
                >
                <span
                  v-if="item.type === 'choice'"
                  class="chip"
                  data-tone="quiet"
                  >{{ placeName({ name: item.sessionName }) }}</span
                >
                <span
                  v-else-if="item.type === 'glance'"
                  class="chip"
                  data-tone="quiet"
                  >{{ item.places.join("、") }}</span
                >
              </div>
              <p v-if="item.type === 'choice'">
                {{ item.reason
                }}<small v-if="item.appraisal"> · {{ item.appraisal }}</small>
              </p>
              <p v-else-if="item.type === 'glance'" class="muted">
                {{ item.reason || "没什么需要 TA 细看的" }}
              </p>
              <p v-else-if="item.type === 'feeling'">
                {{ item.cause || "说不清为什么" }}
                <small>· {{ ORIGIN_LABELS[item.origin] || item.origin }}</small>
              </p>
              <p v-else-if="item.type === 'run'" class="muted">
                {{ item.reason }}
              </p>
              <p v-else>
                {{ item.content
                }}<small v-if="item.note"> · {{ item.note }}</small>
              </p>
            </template>
          </Timeline>
          <Empty
            v-else
            title="今天还很安静"
            text="TA 扫一眼、开口、没出声、心情变化、独处、写日记，都会按时间排在这里。"
          />
        </div>
      </Card>

      <div class="stack side">
        <Card title="今天的注意力" eyebrow="这一天">
          <div class="stack tight">
            <Meter
              v-for="c in LEDGER"
              :key="c.id"
              :label="c.label"
              :value="share(c.id)"
              :warn="Boolean(limits[c.id]) && share(c.id) >= 0.8"
              :text="num(usage[c.id])"
            />
          </div>
          <p class="faint ledger-note">
            共 {{ num(usage.calls) }} 次调用、{{
              num(usage.total)
            }}
            Token，缓存命中 {{ num(usage.cached) }}。
            {{
              limits.total
                ? `每日上限 ${num(limits.total)}。`
                : "没有设置每日上限。"
            }}
          </p>
        </Card>
        <Card title="还没细看的消息" eyebrow="留意">
          <ul v-if="overview?.attention?.length" class="list">
            <li
              v-for="a in overview.attention"
              :key="a.session"
              class="list-row"
            >
              <span class="grow">{{ a.name }}</span>
              <span class="chip" :data-tone="a.unread ? undefined : 'quiet'"
                >{{ a.unread }} 条未读</span
              >
            </li>
          </ul>
          <p v-else class="muted small-text">
            被叫到、聊到 TA 在意的事、熟人说话或攒了不少消息时，TA 才会细看。
          </p>
        </Card>
        <Card title="TA 的这一生" eyebrow="到现在">
          <div class="counts">
            <button @click="go('heart')">
              <b>{{ overview?.counts?.self ?? 0 }}</b
              ><span>自我线索</span>
            </button>
            <button @click="go('people')">
              <b>{{ overview?.counts?.people ?? 0 }}</b
              ><span>认识的人</span>
            </button>
            <button @click="go('life')">
              <b>{{ overview?.counts?.diaries ?? 0 }}</b
              ><span>天日记</span>
            </button>
            <button @click="go('life', 'ahead')">
              <b>{{ overview?.counts?.anticipations ?? 0 }}</b
              ><span>件在等的事</span>
            </button>
          </div>
        </Card>
      </div>
    </section>
  </div>
</template>

<style scoped src="./NowPage.css"></style>
