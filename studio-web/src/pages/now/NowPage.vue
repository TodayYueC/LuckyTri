<script setup lang="ts">
import { t, N_, localized } from "../../i18n";
import { computed, ref, shallowRef, watch } from "vue";
import { usePageActivity } from "../../page-activity";
import { readSnapshot } from "../../api";
import { go, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
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
import Card from "../../components/ui/Card.vue";
import Empty from "../../components/ui/Empty.vue";
import Meter from "../../components/ui/Meter.vue";
import Tabs from "../../components/ui/Tabs.vue";
import Timeline from "../../components/ui/Timeline.vue";
import WallpaperPicker from "./WallpaperPicker.vue";
import { useHeroStage } from "./useHeroStage";

const overview = shallowRef<any>(readSnapshot("/mind") || null);
const today = shallowRef<any>(readSnapshot("/mind/today") || null);
const filter = ref("all");
const wallpaperPicking = ref(false);
const {
  adjusting,
  heroRef,
  imageRef,
  pictureStyle,
  beginPictureDrag,
  movePicture,
  endPictureDrag,
  resetPicture,
  finishPicture,
} = useHeroStage();

const LEDGER = localized([
  { id: "conversation", label: N_("对话") },
  { id: "inner", label: N_("独处与日记") },
  { id: "upkeep", label: N_("整理记忆") },
]);
const p = computed(() => presence.data);
const recentWords = computed(() => {
  const rows = p.value?.recentWords?.filter((item) => item.text?.trim()) || [];
  if (rows.length) return rows.slice(0, 3);
  return p.value?.lastWords ? [p.value.lastWords] : [];
});
const zone = computed(
  () =>
    p.value?.clock?.timeZone ||
    overview.value?.clock?.timeZone ||
    "Asia/Shanghai",
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
const expecting = computed(() =>
  (p.value?.expecting || []).filter((item) => item.content?.trim()).slice(0, 5),
);

function share(id: string) {
  const limit = limits.value[id];
  if (limit) return (usage.value[id] || 0) / limit;
  return usage.value.total ? (usage.value[id] || 0) / usage.value.total : 0;
}

let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  const [o, daily] = await Promise.all([mind.overview(), mind.today()]);
  if (sequence !== loadSequence) return;
  overview.value = o;
  today.value = daily;
}

usePageActivity("now", load);
</script>

<template>
  <div class="page now">
    <div class="now-presentation">
      <section
        ref="heroRef"
        class="now-hero"
        :class="{ 'wallpaper-adjusting': adjusting }"
      >
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
          :aria-label="t('拖动调整首页壁纸构图')"
          @pointerdown.prevent="beginPictureDrag"
          @pointermove.prevent="movePicture"
          @pointerup="endPictureDrag"
          @pointercancel="endPictureDrag"
          @lostpointercapture="endPictureDrag"
        >
          <span class="wallpaper-tip">{{
            t("按住并拖动图片，调整人物位置")
          }}</span>
        </div>
        <div class="wallpaper-controls">
          <template v-if="adjusting">
            <span class="wallpaper-tip-inline">{{
              t("拖动背景调整构图")
            }}</span>
            <button type="button" @click="resetPicture">
              {{ t("恢复默认") }}
            </button>
            <button type="button" class="primary" @click="finishPicture">
              {{ t("完成") }}
            </button>
          </template>
          <button v-else type="button" @click="adjusting = true">
            {{ t("调整构图") }}
          </button>
          <button
            v-if="!adjusting"
            type="button"
            @click="wallpaperPicking = !wallpaperPicking"
          >
            {{ t("换壁纸") }}
          </button>
        </div>
        <WallpaperPicker
          :open="wallpaperPicking && !adjusting"
          @close="wallpaperPicking = false"
        />
      </section>
    </div>

    <section class="notes">
      <article class="note words">
        <span class="eyebrow">{{ t("TA 最近说") }}</span>
        <ul v-if="recentWords.length" class="recent-list">
          <li v-for="(word, i) in recentWords" :key="`${word.time}-${i}`">
            <p class="quote">“{{ word.text }}”</p>
            <small
              >{{ placeName({ name: word.sessionName, id: word.session }) }} ·
              {{ ago(word.time, p?.now) }}</small
            >
          </li>
        </ul>
        <p v-else class="muted">{{ t("TA 还没在哪里开过口。") }}</p>
      </article>
      <article class="note thought">
        <span class="eyebrow">{{ t("放在心上") }}</span>
        <template v-if="p?.thought">
          <p>{{ p.thought.content }}</p>
          <small>{{ p.thought.when }}</small>
        </template>
        <p v-else class="muted">{{ t("心里暂时没有挂着的事。") }}</p>
        <p v-if="p?.will" class="will-line">
          {{ t("正在为自己而活：{content}", { content: p.will.content }) }}
        </p>
        <small v-if="p?.will?.touched">
          {{
            t("被别人的话碰到过 {touched} 次，上次{v}", {
              touched: p.will.touched,
              v: p.will.lastSpoke ? t("出了声") : t("没出声"),
            })
          }}
        </small>
        <p v-if="p?.meaning" class="muted">
          {{ t("上次相遇：{text}", { text: p.meaning.text })
          }}<template v-if="!p.meaning.spoke">{{ t("（没出声）") }}</template>
        </p>
        <small v-if="p?.meaning?.when && !p.meaning.recent">{{
          p.meaning.when
        }}</small>
        <button class="text-button" @click="go('heart', 'notes')">
          {{ t("看看 TA 的便签") }}
        </button>
      </article>
      <article class="note ahead">
        <span class="eyebrow">{{ t("在等的事") }}</span>
        <ul v-if="expecting.length" class="list">
          <li v-for="a in expecting" :key="a.id">
            <b>{{ a.when }}</b>
            <span>{{ a.name ? `${a.name}：` : "" }}{{ a.content }}</span>
            <small>{{ ANTICIPATION_LABELS[a.kind] || a.kind }}</small>
          </li>
        </ul>
        <p v-else class="muted">{{ t("这几天没有 TA 特别在等的事。") }}</p>
        <button class="text-button" @click="go('life', 'ahead')">
          {{ t("约定与期待") }}
        </button>
      </article>
    </section>

    <section class="now-grid">
      <Card
        class="today"
        :title="t('今天的 TA')"
        :sub="today ? t('{v}，按时间排在一起', { v: dayLabel(today.day) }) : ''"
      >
        <template #actions>
          <Tabs
            v-model="filter"
            :label="t('筛选今天的事')"
            :items="[
              { key: 'all', label: t('全部'), count: counts.all },
              { key: 'talk', label: t('开口与沉默'), count: counts.talk },
              { key: 'feel', label: t('心情'), count: counts.feel },
              { key: 'inner', label: t('独处与日记'), count: counts.inner },
            ]"
          />
        </template>
        <div class="today-scroll scroll-pane">
          <Timeline v-if="rows.length" :items="rows" :label="t('今天的 TA')">
            <template #default="{ item }">
              <div class="entry-head">
                <time>{{ clockTime(item.time, zone) }}</time>
                <b v-if="item.type === 'choice'">{{
                  CHOICE_LABELS[item.choice] || item.choice
                }}</b>
                <b v-else-if="item.type === 'glance'">{{
                  item.count > 1
                    ? t("扫了 {count} 眼", { count: item.count })
                    : t("扫了一眼")
                }}</b>
                <b v-else-if="item.type === 'feeling'">{{
                  t("心情 · {feeling}", { feeling: item.feeling })
                }}</b>
                <b v-else-if="item.type === 'run'"
                  >{{ RUN_LABELS[item.kind] || item.kind }} ·
                  {{ RUN_STATES[item.status] || item.status }}</b
                >
                <b v-else>{{
                  t("约定 · {v}", {
                    v: ANTICIPATION_STATES[item.status] || item.status,
                  })
                }}</b>
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
                {{ item.reason || t("没什么需要 TA 细看的") }}
              </p>
              <p v-else-if="item.type === 'feeling'">
                {{ item.cause || t("说不清为什么") }}
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
            :title="t('今天还很安静')"
            :text="
              t(
                'TA 扫一眼、开口、没出声、心情变化、独处、写日记，都会按时间排在这里。',
              )
            "
          />
        </div>
      </Card>

      <div class="stack side">
        <Card :title="t('今天的注意力')" :eyebrow="t('这一天')">
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
            {{
              t("共 {v} 次调用、{v2} Token，缓存命中 {v3}。 {v4}", {
                v: num(usage.calls),
                v2: num(usage.total),
                v3: num(usage.cached),
                v4: limits.total
                  ? t("每日上限 {v}。", { v: num(limits.total) })
                  : t("没有设置每日上限。"),
              })
            }}
          </p>
        </Card>
        <Card :title="t('还没细看的消息')" :eyebrow="t('留意')">
          <ul v-if="overview?.attention?.length" class="list">
            <li
              v-for="a in overview.attention"
              :key="a.session"
              class="list-row"
            >
              <span class="grow">{{ a.name }}</span>
              <span class="chip" :data-tone="a.unread ? undefined : 'quiet'">{{
                t("{unread} 条未读", { unread: a.unread })
              }}</span>
            </li>
          </ul>
          <p v-else class="muted small-text">
            {{
              t(
                "被叫到、聊到 TA 在意的事、熟人说话或攒了不少消息时，TA 才会细看。",
              )
            }}
          </p>
        </Card>
        <Card :title="t('TA 的这一生')" :eyebrow="t('到现在')">
          <div class="counts">
            <button @click="go('heart')">
              <b>{{ overview?.counts?.self ?? 0 }}</b
              ><span>{{ t("自我线索") }}</span>
            </button>
            <button @click="go('people')">
              <b>{{ overview?.counts?.people ?? 0 }}</b
              ><span>{{ t("认识的人") }}</span>
            </button>
            <button @click="go('life')">
              <b>{{ overview?.counts?.diaries ?? 0 }}</b
              ><span>{{ t("天日记") }}</span>
            </button>
            <button @click="go('life', 'ahead')">
              <b>{{ overview?.counts?.anticipations ?? 0 }}</b
              ><span>{{ t("件在等的事") }}</span>
            </button>
          </div>
        </Card>
      </div>
    </section>
  </div>
</template>

<style scoped src="./NowPage.css"></style>
