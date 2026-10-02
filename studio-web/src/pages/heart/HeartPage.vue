<script setup lang="ts">
import { t } from "../../i18n";
import { computed, ref, shallowRef, watch } from "vue";
import { usePageActivity } from "../../page-activity";
import { readSnapshot } from "../../api";
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
const self = shallowRef<any>(readSnapshot("/mind/self") || null);
const overview = shallowRef<any>(readSnapshot("/mind/mood") || null);
const thoughts = shallowRef<any[]>(readSnapshot("/mind/thoughts?q=") || []);
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
  (self.value?.threads || []).filter(
    (strand: any) => strand.status !== "closed",
  ),
);
const listVisibleLimit = 4;
const expandedGroups = ref<Record<string, boolean>>({});
const closed = computed(() =>
  (self.value?.threads || []).filter(
    (strand: any) => strand.status === "closed",
  ),
);
const groups = computed(() => {
  const kinds = self.value?.kinds || {};
  return Object.entries(kinds)
    .map(([kind, label]) => ({
      kind,
      label: label as string,
      threads: threads.value.filter((strand: any) => strand.kind === kind),
    }))
    .filter((g) => g.threads.length);
});

function tag(strand: any) {
  if (strand.core) return t("TA 最核心的部分");
  if (strand.faded) return t("在远方：很久没被触及");
  if (strand.fading) return t("慢慢淡出");
  return SELF_STATUS[strand.status] || strand.status;
}

function visibleGroupThreads(group: (typeof groups.value)[number]) {
  return expandedGroups.value[group.kind]
    ? group.threads
    : group.threads.slice(0, listVisibleLimit);
}

function toggleGroup(kind: string) {
  expandedGroups.value = {
    ...expandedGroups.value,
    [kind]: !expandedGroups.value[kind],
  };
}

let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  const [s, o, l] = await Promise.all([
    mind.self(),
    mind.mood(),
    mind.notes(query.value),
  ]);
  if (sequence !== loadSequence) return;
  self.value = s;
  overview.value = o;
  thoughts.value = l;
  if (chosen.value)
    chosen.value =
      s.threads.find((strand: any) => strand.thread === chosen.value.thread) ||
      null;
}

async function search(q: string) {
  const sequence = ++loadSequence;
  query.value = q;
  const result = await mind.notes(q);
  if (sequence === loadSequence) thoughts.value = result;
}

async function open(strand: any) {
  chosen.value = strand;
  history.value = [];
  history.value = await mind.thread(strand.thread);
}

async function revoke(strand: any) {
  const reason = await askText(
    t(
      "撤销「{content}」？撤销后 TA 不会再这样认为，之后的独处也不会把它写回来。可以写下原因（可不填）：",
      { content: strand.content },
    ),
    {
      title: t("撤销这条线索"),
      confirmText: t("撤销"),
      danger: true,
      placeholder: t("原因"),
    },
  );
  if (reason === null) return;
  try {
    await mind.revoke("self", strand.thread, reason);
    toast(t("已撤销"));
    chosen.value = null;
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  }
}

watch(view, (next) => {
  if (studio.page === "heart") setSub(next === "stars" ? "" : next);
});
watch(
  () => [studio.page, studio.sub],
  ([page, sub]) => {
    if (page !== "heart") return;
    if (sub === "notes" || sub === "list") view.value = sub;
    else if (!sub && view.value === "notes") view.value = "stars";
  },
);
usePageActivity("heart", load);
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
        :label="t('内心的分区')"
        :items="[
          { key: 'stars', label: t('心灵星图'), count: threads.length },
          { key: 'list', label: t('线索清单') },
          { key: 'notes', label: t('放在心上'), count: thoughts.length },
        ]"
      />
      <p v-if="view !== 'notes'" class="muted">
        {{
          t("她从真实经历里慢慢认识自己。点开一条线索，可以看到它如何变化。")
        }}
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
          :title="t('TA 还没有长出关于自己的东西')"
          :text="
            t(
              '聊得多了、独处过、写过日记，TA 会慢慢发现自己喜欢什么、怎么看事情、想做什么。天性只是种子。',
            )
          "
        />
      </template>

      <section v-else-if="view === 'list'" class="thread-groups">
        <div
          v-for="g in groups"
          :key="g.kind"
          class="card thread-group"
          :data-thread-kind="g.kind"
        >
          <h2>
            <i :style="{ background: KIND_COLORS[g.kind] }"></i>{{ g.label }} ·
            {{ g.threads.length }}
          </h2>
          <button
            v-for="strand in visibleGroupThreads(g)"
            :key="strand.thread"
            class="thread"
            :class="{ faded: strand.faded, core: strand.core }"
            :data-thread="strand.thread"
            @click="open(strand)"
          >
            <span
              class="chip"
              :data-tone="strand.faded || strand.fading ? 'quiet' : undefined"
              >{{ tag(strand) }}</span
            >
            <span class="thread-text">{{ strand.content }}</span>
            <small
              >{{ t("强度 {v}", { v: percent(strand.strength) })
              }}<template v-if="strand.salience !== null">
                {{
                  t("· 此刻的分量 {v}", { v: percent(strand.salience) })
                }}</template
              ></small
            >
          </button>
          <button
            v-if="g.threads.length > listVisibleLimit"
            type="button"
            class="thread-more"
            :aria-expanded="Boolean(expandedGroups[g.kind])"
            @click="toggleGroup(g.kind)"
          >
            {{
              expandedGroups[g.kind]
                ? t("收起线索")
                : t("再看 {v} 条线索", {
                    v: g.threads.length - listVisibleLimit,
                  })
            }}
            <span aria-hidden="true">{{
              expandedGroups[g.kind] ? "↑" : "↓"
            }}</span>
          </button>
        </div>
        <Empty
          v-if="!groups.length"
          :title="t('TA 还没有长出关于自己的东西')"
          :text="t('天性只是种子，其余的都从经历里来。')"
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
            <span class="eyebrow">{{ t("放下") }}</span>
            <b>{{
              t("TA 自己放下的 · {length}", { length: closed.length })
            }}</b>
          </summary>
          <ul v-if="closed.length" class="list">
            <li v-for="strand in closed" :key="strand.thread" class="list-row">
              <span class="chip" data-tone="quiet">{{ t("放下") }}</span>
              <span class="grow">{{ strand.content }}</span>
              <time class="faint">{{ when(strand.created) }}</time>
            </li>
          </ul>
          <p v-else class="muted">{{ t("没有。") }}</p>
        </details>
        <details class="card fold">
          <summary>
            <span class="eyebrow">{{ t("撤销") }}</span>
            <b>{{
              t("你撤销过的 · {length}", { length: self.revoked.length })
            }}</b>
          </summary>
          <ul v-if="self.revoked.length" class="list">
            <li v-for="r in self.revoked" :key="r.id" class="list-row">
              <span class="chip" data-tone="danger">{{ t("撤销") }}</span>
              <span class="grow"
                >{{ r.content
                }}<small v-if="r.reason" class="faint">
                  · {{ r.reason }}</small
                ></span
              >
              <time class="faint">{{ when(r.created) }}</time>
            </li>
          </ul>
          <p v-else class="muted">{{ t("没有。") }}</p>
        </details>
      </div>
    </template>

    <Sheet
      :open="Boolean(chosen)"
      :title="chosen ? self?.kinds?.[chosen.kind] || chosen.kind : ''"
      :eyebrow="t('一颗星')"
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
          <Meter :label="t('强度')" :value="chosen.strength" />
          <Meter
            v-if="chosen.salience !== null"
            :label="t('此刻的分量')"
            :value="chosen.salience"
          />
        </div>
        <dl class="kv">
          <dt>{{ t("经历的天数") }}</dt>
          <dd>{{ t("{length} 天", { length: chosen.days.length }) }}</dd>
          <dt>{{ t("来源") }}</dt>
          <dd>{{ t("{length} 处", { length: chosen.sources.length }) }}</dd>
          <dt>{{ t("最近一次被触及") }}</dt>
          <dd>{{ when(chosen.created) }}</dd>
        </dl>
        <section>
          <h3 class="sheet-title">
            {{
              t("怎么变成现在这样的 · {versions} 个版本", {
                versions: chosen.versions,
              })
            }}
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
          {{ t("撤销这条线索") }}
        </button>
        <p class="faint">
          {{
            t(
              "撤销后 TA 不会再这样认为；这只是拿走一段理解，不会改写发生过的事。",
            )
          }}
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
  align-items: start;
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
.thread-more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 13px;
  border: 1px dashed #ffffffd0;
  border-radius: 16px;
  background: linear-gradient(120deg, #ffffff9c, #ffffff4d);
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 650;
  transition:
    transform 0.4s var(--spring),
    background 0.25s,
    border-color 0.25s;
}
.thread-more:hover {
  transform: translateY(-2px);
  border-color: #fff;
  background: #ffffffcf;
}
.thread-more:active {
  transform: scale(0.98);
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
.heart-bar {
  padding: 4px 2px 2px;
}
.heart-bar p {
  max-width: 50ch;
  line-height: 1.65;
}
.thread-groups {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 355px), 1fr));
  gap: 16px;
}
.thread-group {
  isolation: isolate;
  overflow: hidden;
  gap: 10px;
  border-radius: 28px;
  border-color: #ffffffe6;
  background: linear-gradient(138deg, #ffffffcb, #ffffff63 66%, #deecff4f);
  box-shadow:
    inset 0 2px 0 #fff,
    0 20px 37px -31px #637cad;
}
.thread-group::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 140px;
  height: 140px;
  top: -74px;
  right: -51px;
  border-radius: 50%;
  background: #dceaff9c;
  filter: blur(23px);
}
.thread-group h2 {
  padding: 2px 3px 8px;
  border-bottom: 1px solid #ffffffc2;
  font-size: 15px;
}
.thread-group h2 i {
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  box-shadow:
    0 0 0 4px #ffffff8a,
    0 4px 12px #6895c966;
}
.thread {
  position: relative;
  border: 1px solid #ffffffd7;
  border-radius: 18px;
  background: linear-gradient(120deg, #ffffffbc, #ffffff6e);
  box-shadow: inset 0 1px 0 #fff;
  transition:
    transform 0.42s var(--spring),
    box-shadow 0.25s;
}
.thread:hover:not(:disabled) {
  transform: translateY(-3px) scale(1.015);
  border-color: #fff;
  box-shadow: 0 14px 22px -18px #6280b5;
}
.thread:active:not(:disabled) {
  transform: scale(0.975);
}
.thread.core {
  border-color: color-mix(in srgb, var(--accent) 28%, #fff);
  background: linear-gradient(
    125deg,
    #ffffffd0,
    color-mix(in srgb, var(--accent-soft) 44%, transparent)
  );
}
.thread.faded {
  opacity: 0.68;
  border-style: solid;
}
.set-aside .fold {
  border-radius: 25px;
  border: 1px solid #ffffffe6;
  background: linear-gradient(145deg, #ffffffbb, #ffffff5c);
  box-shadow: inset 0 1px 0 #fff;
}
.set-aside .fold summary {
  transition: transform 0.38s var(--spring);
}
.set-aside .fold summary:hover {
  transform: translateX(4px);
}
.versions li {
  border: 1px solid #ffffffd9;
  background: #ffffff9c;
  border-radius: 17px;
  box-shadow: inset 0 1px 0 #fff;
}
@media (max-width: 760px) {
  .heart-bar p {
    flex-basis: 100%;
  }
}
</style>
