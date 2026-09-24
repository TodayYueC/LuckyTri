<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "../../api";
import { askText } from "../../dialog";
import { setSub, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import {
  KIND_COLORS,
  ORIGIN_LABELS,
  SELF_STATUS,
  mind,
  percent,
  when,
} from "../../plates/mind";
import { useMedia } from "../../media";
import Tabs from "../../components/ui/Tabs.vue";
import Sheet from "../../components/ui/Sheet.vue";
import Meter from "../../components/ui/Meter.vue";
import Empty from "../../components/ui/Empty.vue";
import MoodRibbon from "./MoodRibbon.vue";
import StarMap from "./StarMap.vue";
import NotesWall from "./NotesWall.vue";

const narrow = useMedia("(max-width: 760px)");
const self = ref<any>(null);
const overview = ref<any>(null);
const thoughts = ref<any[]>([]);
const query = ref("");
const view = ref(
  studio.sub === "notes"
    ? "notes"
    : studio.sub === "list" || narrow.value
      ? "list"
      : "stars",
);
const chosen = ref<any>(null);
const history = ref<any[]>([]);

const threads = computed(() =>
  (self.value?.threads || []).filter((t: any) => t.status !== "closed"),
);
const closed = computed(() =>
  (self.value?.threads || []).filter((t: any) => t.status === "closed"),
);
const groups = computed(() => {
  const kinds = self.value?.kinds || {};
  return Object.entries(kinds)
    .map(([kind, label]) => ({
      kind,
      label: label as string,
      threads: threads.value.filter((t: any) => t.kind === kind),
    }))
    .filter((g) => g.threads.length);
});

function tag(t: any) {
  if (t.core) return "TA 最核心的部分";
  if (t.faded) return "在远方：很久没被触及";
  if (t.fading) return "慢慢淡出";
  return SELF_STATUS[t.status] || t.status;
}

async function load() {
  const [s, o, l] = await Promise.all([
    mind.self(),
    mind.overview(),
    mind.life(query.value),
  ]);
  self.value = s;
  overview.value = o;
  thoughts.value = l.thoughts;
  if (chosen.value)
    chosen.value =
      s.threads.find((t: any) => t.thread === chosen.value.thread) || null;
}

async function search(q: string) {
  query.value = q;
  thoughts.value = (await mind.life(q)).thoughts;
}

async function open(t: any) {
  chosen.value = t;
  history.value = [];
  history.value = await mind.thread(t.thread);
}

async function revoke(t: any) {
  const reason = await askText(
    `撤销「${t.content}」？撤销后 TA 不会再这样认为，之后的独处也不会把它写回来。可以写下原因（可不填）：`,
    {
      title: "撤销这条线索",
      confirmText: "撤销",
      danger: true,
      placeholder: "原因",
    },
  );
  if (reason === null) return;
  try {
    await mind.revoke("self", t.thread, reason);
    toast("已撤销");
    chosen.value = null;
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  }
}

watch(view, (next) => setSub(next === "stars" ? "" : next));
watch(
  () => studio.sub,
  (sub) => {
    if (sub === "notes" || sub === "list") view.value = sub;
    else if (!sub && view.value === "notes") view.value = "stars";
  },
);
watch(() => studio.tick, load);
onMounted(load);
</script>

<template>
  <div class="page heart">
    <MoodRibbon
      v-if="overview"
      :moods="overview.moods"
      :baseline="overview.affect.baseline"
      :time-zone="overview.clock.timeZone"
    />

    <div class="heart-bar">
      <Tabs
        v-model="view"
        label="内心的分区"
        :items="[
          { key: 'stars', label: '心灵星图', count: threads.length },
          { key: 'list', label: '线索清单' },
          { key: 'notes', label: '放在心上', count: thoughts.length },
        ]"
      />
      <p v-if="view !== 'notes'" class="muted">
        每一条都指向真实发生过的事。一次经历只让它变一点；新的特质要在不同的日子里反复出现才会成形。你可以撤销，但不能替
        TA 改写。
      </p>
    </div>

    <template v-if="self">
      <template v-if="view === 'stars'">
        <StarMap
          v-if="threads.length"
          :threads="threads"
          :kinds="self.kinds"
          :activity="presence.data?.activity?.kind"
          @open="open"
        />
        <Empty
          v-else
          title="TA 还没有长出关于自己的东西"
          text="聊得多了、独处过、写过日记，TA 会慢慢发现自己喜欢什么、怎么看事情、想做什么。天性只是种子。"
        />
      </template>

      <section v-else-if="view === 'list'" class="thread-groups">
        <div v-for="g in groups" :key="g.kind" class="card thread-group">
          <h2>
            <i :style="{ background: KIND_COLORS[g.kind] }"></i>{{ g.label }} ·
            {{ g.threads.length }}
          </h2>
          <button
            v-for="t in g.threads"
            :key="t.thread"
            class="thread"
            :class="{ faded: t.faded, core: t.core }"
            :data-thread="t.thread"
            @click="open(t)"
          >
            <span
              class="chip"
              :data-tone="t.faded || t.fading ? 'quiet' : undefined"
              >{{ tag(t) }}</span
            >
            <span class="thread-text">{{ t.content }}</span>
            <small
              >强度 {{ percent(t.strength)
              }}<template v-if="t.salience !== null">
                · 此刻的分量 {{ percent(t.salience) }}</template
              ></small
            >
          </button>
        </div>
        <Empty
          v-if="!groups.length"
          title="TA 还没有长出关于自己的东西"
          text="天性只是种子，其余的都从经历里来。"
        />
      </section>

      <NotesWall
        v-else
        :thoughts="thoughts"
        :kinds="overview?.kinds?.thoughts || {}"
        :query="query"
        @changed="load"
        @search="search"
      />

      <div v-if="view !== 'notes'" class="grid-2 set-aside">
        <details class="card fold">
          <summary>
            <span class="eyebrow">SET ASIDE</span>
            <b>TA 自己放下的 · {{ closed.length }}</b>
          </summary>
          <ul v-if="closed.length" class="list">
            <li v-for="t in closed" :key="t.thread" class="list-row">
              <span class="chip" data-tone="quiet">放下</span>
              <span class="grow">{{ t.content }}</span>
              <time class="faint">{{ when(t.created) }}</time>
            </li>
          </ul>
          <p v-else class="muted">没有。</p>
        </details>
        <details class="card fold">
          <summary>
            <span class="eyebrow">WITHDRAWN</span>
            <b>你撤销过的 · {{ self.revoked.length }}</b>
          </summary>
          <ul v-if="self.revoked.length" class="list">
            <li v-for="r in self.revoked" :key="r.id" class="list-row">
              <span class="chip" data-tone="danger">撤销</span>
              <span class="grow"
                >{{ r.content
                }}<small v-if="r.reason" class="faint">
                  · {{ r.reason }}</small
                ></span
              >
              <time class="faint">{{ when(r.created) }}</time>
            </li>
          </ul>
          <p v-else class="muted">没有。</p>
        </details>
      </div>
    </template>

    <Sheet
      :open="Boolean(chosen)"
      :title="chosen ? self?.kinds?.[chosen.kind] || chosen.kind : ''"
      eyebrow="一颗星"
      @close="chosen = null"
    >
      <div v-if="chosen" class="thread-sheet stack">
        <p class="thread-content">{{ chosen.content }}</p>
        <div class="row">
          <span class="chip">{{ tag(chosen) }}</span>
          <span class="chip" data-tone="quiet">{{
            ORIGIN_LABELS[chosen.origin] || chosen.origin
          }}</span>
        </div>
        <div class="stack tight">
          <Meter label="强度" :value="chosen.strength" />
          <Meter
            v-if="chosen.salience !== null"
            label="此刻的分量"
            :value="chosen.salience"
          />
        </div>
        <dl class="kv">
          <dt>经历的天数</dt>
          <dd>{{ chosen.days.length }} 天</dd>
          <dt>来源</dt>
          <dd>{{ chosen.sources.length }} 处</dd>
          <dt>最近一次被触及</dt>
          <dd>{{ when(chosen.created) }}</dd>
        </dl>
        <section>
          <h3 class="sheet-title">
            怎么变成现在这样的 · {{ chosen.versions }} 个版本
          </h3>
          <ol class="versions">
            <li v-for="v in history" :key="v.id">
              <time>{{ when(v.created) }}</time>
              <b>{{ percent(v.strength) }}</b>
              <span>{{ v.content }}</span>
            </li>
          </ol>
        </section>
        <button class="danger" data-revoke-thread @click="revoke(chosen)">
          撤销这条线索
        </button>
        <p class="faint">
          撤销后 TA 不会再这样认为；这只是拿走一段理解，不会改写发生过的事。
        </p>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.heart {
  display: grid;
  gap: var(--gap);
}
.heart-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.heart-bar p {
  flex: 1 1 380px;
  font-size: 13px;
}
.thread-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--gap);
}
.thread-group {
  display: grid;
  align-content: start;
  gap: 10px;
}
.thread-group h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.thread-group h2 i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.thread {
  display: grid;
  justify-items: start;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 16px;
  text-align: left;
  font-weight: 500;
}
.thread.core {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface-strong));
}
.thread.faded {
  opacity: 0.6;
  border-style: dashed;
}
.thread-text {
  font-size: 14px;
  line-height: 1.6;
}
.thread small {
  color: var(--ink-soft);
  font-size: 12px;
}
.fold summary {
  display: grid;
  gap: 2px;
}
.fold[open] summary {
  margin-bottom: 12px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.thread-content {
  font: 600 18px/1.7 var(--font-display);
}
.sheet-title {
  margin-bottom: 10px;
  font-size: 14px;
}
.versions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.versions li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ink) 4%, transparent);
  font-size: 13px;
}
.versions time {
  color: var(--ink-soft);
}
.versions b {
  color: var(--accent);
}
.thread-sheet > .danger {
  justify-self: start;
}
</style>
