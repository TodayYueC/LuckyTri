<script setup lang="ts">
import { t, intlLocale } from "../../i18n";
import { computed, ref } from "vue";
import { toast } from "../../api";
import { askText } from "../../dialog";
import {
  ANTICIPATION_LABELS,
  ANTICIPATION_STATES,
  mind,
  when,
} from "../../plates/mind";
import Tabs from "../../components/ui/Tabs.vue";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{ items: any[]; timeZone: string; today: string }>();
const emit = defineEmits<{ changed: [] }>();
const view = ref("calendar");
const [ty, tm] = props.today.split("-").map(Number);
const year = ref(ty);
const month = ref(tm);
const picked = ref(props.today);
// Monday first, in the language of the page (一 … 日, M … S).
const WEEK = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((day) =>
    new Date(Date.UTC(2024, 0, day)).toLocaleDateString(intlLocale(), {
      weekday: "narrow",
      timeZone: "UTC",
    }),
  ),
);

const localDay = (time: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: props.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);

const byDay = computed(() => {
  const map = new Map<string, any[]>();
  for (const a of props.items) {
    const key = localDay(a.occurrence);
    map.set(key, [...(map.get(key) || []), a]);
  }
  return map;
});

const cells = computed(() => {
  const first = new Date(Date.UTC(year.value, month.value - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year.value, month.value, 0)).getUTCDate();
  const out: ({ day: string; n: number; items: any[] } | null)[] =
    Array(lead).fill(null);
  for (let n = 1; n <= days; n++) {
    const day = `${year.value}-${String(month.value).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    out.push({ day, n, items: byDay.value.get(day) || [] });
  }
  return out;
});

const pickedItems = computed(() => byDay.value.get(picked.value) || []);
const ordered = computed(() => {
  const pending = props.items
    .filter((a) => a.state === "pending")
    .sort((a, b) => a.occurrence - b.occurrence);
  const rest = props.items
    .filter((a) => a.state !== "pending")
    .sort((a, b) => b.occurrence - a.occurrence);
  return [...pending, ...rest];
});

function shift(step: number) {
  const m = month.value + step;
  year.value += Math.floor((m - 1) / 12);
  month.value = ((m - 1 + 120) % 12) + 1;
}

async function revoke(a: any) {
  const reason = await askText(
    t(
      "撤销「{content}」？TA 不再惦记这件事，之后整理记忆时也不会把它写回来。可以写下原因（可不填）：",
      { content: a.content },
    ),
    {
      title: t("撤销这个约定"),
      confirmText: t("撤销"),
      danger: true,
      placeholder: t("原因"),
    },
  );
  if (reason === null) return;
  try {
    await mind.revoke("anticipation", a.id, reason);
    toast(t("已撤销"));
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

function tone(a: any) {
  if (["missed", "lapsed", "revoked"].includes(a.state)) return "danger";
  if (a.state === "pending") return undefined;
  return "quiet";
}
</script>

<template>
  <section class="ahead">
    <div class="ahead-head">
      <div>
        <span class="eyebrow">{{ t("AHEAD · 向前看") }}</span>
        <h2>{{ t("让未来有值得期待的事。") }}</h2>
        <p class="muted">
          {{ t("约定、想做的事与每年都会回来的日子，都安静地留在这里。") }}
        </p>
      </div>
      <Tabs
        v-model="view"
        :label="t('约定的视图')"
        :items="[
          { key: 'calendar', label: t('日历') },
          { key: 'list', label: t('清单'), count: items.length },
        ]"
      />
    </div>

    <div v-if="view === 'calendar'" class="calendar-wrap">
      <div class="calendar card">
        <header>
          <button
            class="icon-button ghost"
            :aria-label="t('上个月')"
            @click="shift(-1)"
          >
            ‹
          </button>
          <b>{{ t("{year} 年 {month} 月", { year, month }) }}</b>
          <button
            class="icon-button ghost"
            :aria-label="t('下个月')"
            @click="shift(1)"
          >
            ›
          </button>
        </header>
        <div class="grid" role="grid">
          <span v-for="(w, i) in WEEK" :key="i" class="wd">{{ w }}</span>
          <template v-for="(c, i) in cells" :key="i">
            <span v-if="!c" class="blank"></span>
            <button
              v-else
              class="cell"
              :class="{
                today: c.day === today,
                picked: c.day === picked,
                has: c.items.length,
              }"
              :aria-label="
                t('{n} 日{v}', {
                  n: c.n,
                  v: c.items.length
                    ? t('，{length} 件事', { length: c.items.length })
                    : '',
                })
              "
              @click="picked = c.day"
            >
              {{ c.n }}
              <i v-if="c.items.length" class="dots"
                ><em
                  v-for="a in c.items.slice(0, 3)"
                  :key="a.id"
                  :data-state="a.state"
                ></em
              ></i>
            </button>
          </template>
        </div>
      </div>
      <div class="picked card">
        <h3>
          {{
            t("{month} 月 {date} 日", {
              month: Number(picked.slice(5, 7)),
              date: Number(picked.slice(8, 10)),
            })
          }}
        </h3>
        <ul v-if="pickedItems.length" class="list">
          <li
            v-for="a in pickedItems"
            :key="a.id"
            class="ahead-item"
            :class="{ closed: a.state !== 'pending' }"
          >
            <span class="chip" :data-tone="tone(a)">{{
              ANTICIPATION_STATES[a.state] || a.state
            }}</span>
            <div class="grow">
              <p>{{ a.name ? `${a.name}：` : "" }}{{ a.content }}</p>
              <small class="faint"
                >{{ ANTICIPATION_LABELS[a.kind] || a.kind }} · {{ a.when
                }}{{ a.recurrence === "yearly" ? t(" · 每年") : "" }}</small
              >
            </div>
            <button
              v-if="a.state !== 'revoked'"
              class="text-button"
              @click="revoke(a)"
            >
              {{ t("撤销") }}
            </button>
          </li>
        </ul>
        <p v-else class="muted">{{ t("这一天没有 TA 在等的事。") }}</p>
      </div>
    </div>

    <div v-else>
      <ul v-if="ordered.length" class="list">
        <li
          v-for="a in ordered"
          :key="a.id"
          class="ahead-item card flat"
          :class="{ closed: a.state !== 'pending' }"
          :data-ahead="a.id"
        >
          <time class="when">{{
            when(a.occurrence, timeZone).slice(0, 5)
          }}</time>
          <span class="chip" :data-tone="tone(a)">{{
            ANTICIPATION_STATES[a.state] || a.state
          }}</span>
          <div class="grow">
            <p>{{ a.name ? `${a.name}：` : "" }}{{ a.content }}</p>
            <small class="faint">
              {{ ANTICIPATION_LABELS[a.kind] || a.kind }} · {{ a.when
              }}{{ a.recurrence === "yearly" ? t(" · 每年") : ""
              }}{{ a.private ? t(" · 私下知道的") : ""
              }}{{ a.closed_note ? ` · ${a.closed_note}` : "" }}
            </small>
          </div>
          <button
            v-if="a.state !== 'revoked'"
            class="text-button"
            @click="revoke(a)"
          >
            {{ t("撤销") }}
          </button>
        </li>
      </ul>
      <Empty
        v-else
        :title="t('还没有 TA 在等的事')"
        :text="t('有人说起之后的安排、TA 答应了别人什么，整理记忆时会记下来。')"
      />
    </div>
  </section>
</template>

<style scoped src="./AheadCalendar.css"></style>
