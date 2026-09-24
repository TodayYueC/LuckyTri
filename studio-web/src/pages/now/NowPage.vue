<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "../../api";
import { go, studio } from "../../stores/studio";
import { presence, refreshPresence } from "../../stores/presence";
import { liveMood } from "../../mood/useMood";
import { activityLine, latelyLine, statusLine } from "../../mood/presence";
import {
  ANTICIPATION_LABELS,
  ANTICIPATION_STATES,
  CHOICE_LABELS,
  ORIGIN_LABELS,
  RUN_LABELS,
  RUN_STATES,
  mind,
} from "../../plates/mind";
import { ago, clockTime, dayLabel, num } from "../../format";
import { useMedia } from "../../media";
import type { Page } from "../../router";
import TaOrb from "../../components/ta/TaOrb.vue";
import Card from "../../components/ui/Card.vue";
import Empty from "../../components/ui/Empty.vue";
import Meter from "../../components/ui/Meter.vue";
import Tabs from "../../components/ui/Tabs.vue";
import Timeline from "../../components/ui/Timeline.vue";

const overview = ref<any>(null);
const today = ref<any>(null);
const running = ref(false);
const filter = ref("all");
const narrow = useMedia("(max-width: 760px)");

const FIX: Record<string, [Page, string?]> = {
  token: ["system", "connect"],
  qq: ["system", "connect"],
  model: ["system", "models"],
  mode: ["system", "runtime"],
  session: ["chats"],
  persona: ["nature"],
};
const LEDGER = [
  { id: "conversation", label: "对话" },
  { id: "inner", label: "独处与日记" },
  { id: "upkeep", label: "整理记忆" },
];

const p = computed(() => presence.data);
const affect = computed(() => p.value?.affect || overview.value?.affect || {});
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
const settings = computed(() => studio.health.settings);
const readiness = computed(() => studio.health.readiness);
const online = computed(() => Boolean(studio.health.connection?.online));
const enabledSessions = computed(
  () =>
    (studio.core.sessions || []).filter((s: any) => s.enabled && !s.archived)
      .length,
);
const busyMind = computed(
  () =>
    running.value ||
    Boolean(overview.value?.busy) ||
    ["solitude", "diary", "review", "night"].includes(activity.value),
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
      if (!last.places.includes(item.sessionName))
        last.places.push(item.sessionName);
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
      places: item.type === "glance" ? [item.sessionName] : [],
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

async function run(kind: "reflect" | "review") {
  running.value = true;
  try {
    const result = await mind[kind]();
    toast(result.reason || "完成了", result.status === "error");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    running.value = false;
    await Promise.all([load(), refreshPresence()]);
  }
}

function fix(id: string) {
  const [page, sub] = FIX[id] || ["system"];
  go(page, sub);
}

onMounted(load);
watch(() => [studio.tick, studio.pulse], load);
</script>

<template>
  <div class="page now">
    <section class="now-hero">
      <div class="stage">
        <span class="orbit o1" aria-hidden="true"></span>
        <span class="orbit o2" aria-hidden="true"></span>
        <TaOrb
          :mood="liveMood"
          :activity="activity"
          :size="narrow ? 176 : 250"
          :speech="speech"
          interactive
          @open-chat="studio.chatOpen = true"
        />
        <p class="orb-hint">戳一下 · 按住摸摸头 · 双击聊天</p>
      </div>
      <div class="status" aria-live="polite">
        <span class="eyebrow">
          第 {{ p?.dayOfLife ?? overview?.dayOfLife ?? 1 }} 天
          <template v-if="p?.clock">
            · {{ p.clock.period }} {{ p.clock.local.slice(11) }}</template
          >
        </span>
        <h2 class="mood-word">{{ affect.mood || "平静" }}</h2>
        <p class="lede">
          {{ statusLine(affect) || "没有特别牵动 TA 的事，心情慢慢回到平常。" }}
        </p>
        <div class="row chips">
          <span class="chip activity-chip" :data-activity="activity">{{
            activityLine(p)
          }}</span>
          <span v-if="latelyLine(affect)" class="chip" data-tone="quiet"
            >这阵子 · {{ latelyLine(affect) }}</span
          >
          <span v-if="affect.energyLabel" class="chip" data-tone="quiet"
            >精力 · {{ affect.energyLabel }}</span
          >
          <span
            v-if="overview?.nature?.rhythm?.enabled"
            class="chip"
            data-tone="quiet"
          >
            {{ overview.nature.rhythm.wake }} 醒 /
            {{ overview.nature.rhythm.sleep }} 睡
          </span>
        </div>
        <div class="row actions">
          <button class="primary" @click="studio.chatOpen = true">
            和 TA 聊聊
          </button>
          <button :disabled="busyMind" @click="run('reflect')">
            {{ busyMind ? "TA 正在想…" : "让 TA 独处一会儿" }}
          </button>
          <button :disabled="busyMind" @click="run('review')">
            写下今天的日记
          </button>
        </div>
        <small class="faint">{{
          overview?.reason || "安静下来时，TA 会自己独处。"
        }}</small>
      </div>
    </section>

    <section class="notes">
      <article class="note words">
        <span class="eyebrow">TA 最近说</span>
        <template v-if="p?.lastWords">
          <p class="quote">“{{ p.lastWords.text }}”</p>
          <small
            >{{ p.lastWords.sessionName }} ·
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

    <section v-if="readiness && !readiness.ready" class="card ready">
      <div class="card-head">
        <div>
          <span class="eyebrow"
            >还差 {{ readiness.total - readiness.completed }} 步</span
          >
          <h2>完成这些，TA 就能在 QQ 里说话</h2>
        </div>
        <span class="chip"
          >{{ readiness.completed }} / {{ readiness.total }}</span
        >
      </div>
      <ol class="steps">
        <li v-for="c in readiness.checks" :key="c.id" :class="{ done: c.done }">
          <span class="step-dot" aria-hidden="true">{{
            c.done ? "✓" : ""
          }}</span>
          <div>
            <b>{{ c.name }}</b>
            <small>{{ c.detail }}</small>
          </div>
          <button
            v-if="!c.done"
            class="small"
            :data-fix="c.id"
            @click="fix(c.id)"
          >
            去处理
          </button>
        </li>
      </ol>
    </section>

    <nav class="strip" aria-label="运行状态">
      <button :class="{ off: !online }" @click="go('system', 'connect')">
        <span class="dot" :class="{ off: !online }"></span
        >{{ online ? "QQ 已连接" : "QQ 未连接 · 去连接" }}
      </button>
      <button
        :class="{ off: !settings.enabled }"
        @click="go('system', 'runtime')"
      >
        <span class="dot" :class="{ off: !settings.enabled }"></span>参与聊天{{
          settings.enabled ? "：开" : "：关"
        }}
      </button>
      <button @click="go('system', 'runtime')">
        <span class="dot" :class="{ warn: settings.demo }"></span
        >{{ settings.demo ? "模拟模式：不向 QQ 发送" : "真实回复" }}
      </button>
      <button @click="go('chats')">参与会话 · {{ enabledSessions }}</button>
      <button @click="go('system', 'models')">
        可用模型 · {{ studio.core.models.length }}
      </button>
    </nav>

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
                  >{{ item.sessionName }}</span
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
        <Card title="今天的注意力" eyebrow="TOKEN · 24 小时">
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
        <Card title="还没细看的消息" eyebrow="ATTENTION">
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
        <Card title="TA 的这一生" eyebrow="SO FAR">
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

<style scoped>
.now-hero {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 24px;
  min-height: 380px;
}
.stage {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: center;
  min-height: 360px;
}
.orbit {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 1.5px dashed color-mix(in srgb, var(--accent) 22%, transparent);
  transform: translate(-50%, -54%);
  pointer-events: none;
}
.o1 {
  width: 330px;
  height: 330px;
  animation: spin calc(80s / var(--tempo, 1)) linear infinite;
}
.o2 {
  width: 420px;
  height: 420px;
  border-style: solid;
  border-color: color-mix(in srgb, var(--accent) 10%, transparent);
}
.orb-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-soft);
}
.status {
  display: grid;
  gap: 12px;
  align-content: center;
}
.mood-word {
  font-size: clamp(40px, 6vw, 68px);
  line-height: 1.05;
  letter-spacing: -0.03em;
  background: linear-gradient(120deg, var(--ink), var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.chips {
  gap: 8px;
}
.actions {
  margin-top: 4px;
}
.notes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap);
  margin: 8px 0 var(--gap);
}
.note {
  position: relative;
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 18px 20px;
  border-radius: 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(14px);
  animation: drift 7s ease-in-out infinite alternate;
}
.note:nth-child(2) {
  animation-delay: -2.4s;
}
.note:nth-child(3) {
  animation-delay: -4.6s;
}
.note .quote {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.6;
}
.note small {
  color: var(--ink-soft);
  font-size: 12px;
}
.note .text-button {
  justify-self: start;
  margin-top: 2px;
}
.note li {
  display: grid;
  gap: 1px;
  font-size: 13.5px;
}
.note li b {
  font-size: 12px;
  color: var(--accent);
}
.words {
  background: linear-gradient(
    150deg,
    color-mix(in srgb, var(--orb-a) 55%, var(--surface-strong)),
    var(--surface)
  );
}
.ready {
  margin-bottom: var(--gap);
}
.steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
  border: 1px solid var(--line);
}
.steps li > div {
  flex: 1;
  display: grid;
  min-width: 0;
}
.steps small {
  color: var(--ink-soft);
  font-size: 12px;
}
.step-dot {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--line);
  font-size: 12px;
  font-weight: 700;
}
.steps li.done .step-dot {
  border-color: var(--ok);
  background: var(--ok);
  color: var(--accent-ink);
}
.steps li.done {
  opacity: 0.7;
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: var(--gap);
}
.strip button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 12.5px;
  background: var(--surface);
  backdrop-filter: blur(12px);
}
.now-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: var(--gap);
  align-items: start;
}
.today-scroll {
  max-height: 620px;
  margin-right: -8px;
  padding-right: 8px;
}
.entry-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}
.entry-head time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--ink-soft);
}
.entry-head b {
  font-size: 14px;
}
.entry-head + p {
  margin-top: 3px;
  font-size: 13.5px;
  line-height: 1.65;
}
.entry-head + p small {
  color: var(--ink-soft);
}
.ledger-note {
  margin-top: 12px;
}
.small-text {
  font-size: 13px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.counts button {
  display: grid;
  justify-items: start;
  gap: 0;
  padding: 12px 14px;
  border-radius: 16px;
  text-align: left;
}
.counts b {
  font: 700 24px var(--font-display);
  color: var(--accent);
}
.counts span {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-soft);
}
@keyframes spin {
  to {
    transform: translate(-50%, -54%) rotate(360deg);
  }
}
@keyframes drift {
  from {
    transform: translateY(0) rotate(-0.4deg);
  }
  to {
    transform: translateY(-5px) rotate(0.4deg);
  }
}
@media (max-width: 1100px) {
  .now-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 900px) {
  .now-hero {
    grid-template-columns: minmax(0, 1fr);
    text-align: center;
  }
  .status {
    justify-items: center;
  }
  .chips,
  .actions {
    justify-content: center;
  }
  .notes {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .stage {
    min-height: 250px;
  }
  .o1 {
    width: 230px;
    height: 230px;
  }
  .o2 {
    width: 290px;
    height: 290px;
  }
  .today-scroll {
    max-height: 520px;
  }
}
</style>
