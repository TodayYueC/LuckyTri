<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { go, setSub, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { RUN_LABELS, RUN_STATES, mind, when } from "../../plates/mind";
import { num } from "../../format";
import Tabs from "../../components/ui/Tabs.vue";
import Timeline from "../../components/ui/Timeline.vue";
import Empty from "../../components/ui/Empty.vue";
import DiaryBook from "./DiaryBook.vue";
import AheadCalendar from "./AheadCalendar.vue";

const VIEWS = ["diary", "reviews", "story", "ahead", "shelf"];
const life = ref<any>(null);
const view = ref(VIEWS.includes(studio.sub) ? studio.sub : "diary");
const chapterVersions = ref<Record<number, any[]>>({});
const storyVersions = ref<any[] | null>(null);

const zone = computed(() => presence.data?.clock?.timeZone || "Asia/Shanghai");
const today = computed(
  () =>
    presence.data?.clock?.local?.slice(0, 10) ||
    new Date().toISOString().slice(0, 10),
);

async function load() {
  life.value = await mind.life();
}

async function toggleChapter(n: number) {
  if (chapterVersions.value[n]) {
    const { [n]: _drop, ...rest } = chapterVersions.value;
    chapterVersions.value = rest;
    return;
  }
  chapterVersions.value = {
    ...chapterVersions.value,
    [n]: await mind.chapter(n),
  };
}

async function toggleStory() {
  storyVersions.value = storyVersions.value ? null : await mind.story();
}

watch(view, (next) => setSub(next === "diary" ? "" : next));
watch(
  () => studio.sub,
  (sub) => {
    view.value = VIEWS.includes(sub) ? sub : "diary";
  },
);
watch(() => studio.tick, load);
onMounted(load);
</script>

<template>
  <div class="page life">
    <header class="life-intro">
      <div>
        <span class="eyebrow">LIFE · 一生</span>
        <h1>日子经过，<em>留下自己的形状。</em></h1>
        <p>写下今天，回望从前，也给明天留一点期待。</p>
      </div>
      <div class="life-mark" aria-hidden="true"><span></span></div>
    </header>
    <div class="life-bar">
      <Tabs
        v-model="view"
        label="一生的分区"
        :items="[
          { key: 'diary', label: '日记本', count: life?.diaries.length ?? '' },
          { key: 'reviews', label: '回顾', count: life?.reviews.length ?? '' },
          {
            key: 'story',
            label: '我的来路',
            count: life ? life.chapters.length : '',
          },
          {
            key: 'ahead',
            label: '约定与期待',
            count:
              life?.anticipations.filter((a: any) => a.state === 'pending')
                .length ?? '',
          },
          { key: 'shelf', label: '书架', count: life?.readings.length ?? '' },
        ]"
      />
      <span v-if="life" class="chip" data-tone="quiet"
        >来到这里的第 {{ life.dayOfLife }} 天</span
      >
    </div>

    <template v-if="life">
      <DiaryBook v-if="view === 'diary'" :diaries="life.diaries" />

      <section v-else-if="view === 'reviews'" class="card reviews">
        <div class="card-head">
          <div>
            <span class="eyebrow">回顾</span>
            <h2>TA 的回顾</h2>
            <p>
              每隔一段时间，TA
              在夜里重新看看这段日子：留下了什么、自己怎样在变。
            </p>
          </div>
        </div>
        <Timeline v-if="life.reviews.length" :items="life.reviews" label="回顾">
          <template #default="{ item }">
            <time class="faint">{{ when(item.created, zone) }}</time>
            <p class="review-text">{{ item.content }}</p>
            <blockquote v-if="item.compare">
              和上次回顾比：{{ item.compare }}
            </blockquote>
          </template>
        </Timeline>
        <Empty
          v-else
          title="还没有回顾过"
          text="日记攒到两篇以后，TA 会在睡着的时候第一次回顾。"
        />
      </section>

      <section v-else-if="view === 'story'" class="story">
        <article v-if="life.story" class="chapter preface">
          <span class="eyebrow">前言</span>
          <h2>我的来路 · 第 {{ life.dayOfLife }} 天</h2>
          <p>{{ life.story.content }}</p>
          <button
            v-if="life.storyVersions > 1"
            class="text-button"
            @click="toggleStory"
          >
            {{
              storyVersions
                ? "收起旧版本"
                : `重写过 ${life.storyVersions - 1} 次`
            }}
          </button>
          <ol v-if="storyVersions" class="versions">
            <li v-for="v in storyVersions.slice(1)" :key="v.id">
              <time>{{ when(v.created, zone) }}</time>
              <span>{{ v.content }}</span>
            </li>
          </ol>
        </article>
        <article v-for="c in life.chapters" :key="c.id" class="chapter">
          <span class="eyebrow">第 {{ c.chapter }} 章</span>
          <h2>{{ c.title }}</h2>
          <p>{{ c.content }}</p>
          <button
            v-if="c.versions > 1"
            class="text-button"
            @click="toggleChapter(c.chapter)"
          >
            {{
              chapterVersions[c.chapter]
                ? "收起旧版本"
                : `重写过 ${c.versions - 1} 次`
            }}
          </button>
          <ol v-if="chapterVersions[c.chapter]" class="versions">
            <li v-for="v in chapterVersions[c.chapter].slice(1)" :key="v.id">
              <time>{{ when(v.created, zone) }}</time>
              <span>{{ v.title }}：{{ v.content }}</span>
            </li>
          </ol>
        </article>
        <Empty
          v-if="!life.story && !life.chapters.length"
          title="自传还没开始写"
          text="有了两篇日记之后，TA 会在夜里第一次回顾，写下「我的来路」和第一章。旧的版本都会留着。"
        />
      </section>

      <AheadCalendar
        v-else-if="view === 'ahead'"
        :items="life.anticipations"
        :time-zone="zone"
        :today="today"
        @changed="load"
      />

      <section v-else class="shelf">
        <p class="muted shelf-note">
          独处时，TA
          会从共享资料里挑自己感兴趣的读，一段一段地读下去，读后的想法可以改变
          TA。还有 {{ num(life.unread) }} 段没读。
          <button class="text-button" @click="go('memory', 'shelf')">
            去资料书架放点书
          </button>
        </p>
        <div v-if="life.readings.length" class="books">
          <article v-for="r in life.readings" :key="r.id" class="book-card">
            <div
              class="spine"
              :style="{ '--p': (r.ordinal + 1) / Math.max(1, r.total) }"
            ></div>
            <div>
              <h3>《{{ r.title }}》</h3>
              <small class="faint"
                >第 {{ r.ordinal + 1 }} / {{ r.total }} 段 ·
                {{ when(r.created, zone) }}</small
              >
              <p>{{ r.note || "读完没说什么" }}</p>
            </div>
          </article>
        </div>
        <Empty
          v-else
          title="还没读过什么"
          text="把文章放进「记忆 → 资料书架」的共享集合，TA 独处时会去读。"
        />
      </section>

      <details class="card runs">
        <summary>
          <span class="eyebrow">独处的时候</span>
          <b>独处、日记与夜里的记录 · {{ life.runs.length }}</b>
        </summary>
        <ul v-if="life.runs.length" class="list run-list">
          <li v-for="r in life.runs" :key="r.id" class="run-row">
            <time class="faint">{{ when(r.started, zone) }}</time>
            <span
              class="chip"
              :data-tone="
                r.status === 'error'
                  ? 'danger'
                  : r.status === 'written'
                    ? 'ok'
                    : 'quiet'
              "
            >
              {{ RUN_LABELS[r.kind] || r.kind }} ·
              {{ RUN_STATES[r.status] || r.status }}
            </span>
            <span class="grow">{{ r.reason }}</span>
            <small class="faint"
              >{{ r.model || "未调用模型" }} · {{ num(r.tokens) }} Token</small
            >
          </li>
        </ul>
        <p v-else class="muted">
          安静本身不会留下记录；TA 真正独处、写日记或在夜里整理时才会记下。
        </p>
      </details>
    </template>
  </div>
</template>

<style scoped src="./LifePage.css"></style>
