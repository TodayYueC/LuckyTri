<script setup lang="ts">
import { intlLocale, t } from "../../i18n";
import { computed, ref } from "vue";
import { dateFormatter } from "../../formatters";
const props = defineProps<{ agenda: any }>();
const emit = defineEmits<{ task: [id: string] }>();
const nearby = ref(true);
const windowRange = computed(() => {
  const a = props.agenda;
  if (!nearby.value) return [a.start, a.end];
  const start = Math.max(
    a.start,
    Math.min(
      a.end - 6 * 3600000,
      Math.floor((a.now - a.start) / 3600000) * 3600000 + a.start - 3600000,
    ),
  );
  return [start, Math.min(a.end, start + 6 * 3600000)];
});
const clock = (at: number) =>
  at === props.agenda.end
    ? "24:00"
    : dateFormatter(intlLocale(), {
        timeZone: props.agenda.zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(at));
const position = (at: number) =>
  ((at - windowRange.value[0]) /
    (windowRange.value[1] - windowRange.value[0])) *
  100;
const shown = (b: any) =>
  (b.chartEnd ?? b.end) > b.start &&
  (b.chartEnd ?? b.end) > windowRange.value[0] &&
  b.start < windowRange.value[1];
const style = (b: any) => ({
  left: Math.max(0, position(b.start)) + "%",
  width:
    Math.max(
      0.3,
      Math.min(100, position(b.chartEnd ?? b.end)) -
        Math.max(0, position(b.start)),
    ) + "%",
});
const ticks = computed(() =>
  Array.from(
    { length: 7 },
    (_, i) =>
      windowRange.value[0] +
      ((windowRange.value[1] - windowRange.value[0]) * i) / 6,
  ),
);
const upcoming = computed(() =>
  props.agenda.planned.filter((b: any) => b.kind !== "sleep").slice(0, 18),
);
const description = (b: any) =>
  `${clock(b.start)} — ${clock(b.end)} · ${b.title} · ${b.label || ({ rest: t("休息建议"), free: t("自由安排"), sleep: t("作息安排") } as any)[b.kind] || t("已发生")}`;
const investment = (b: any) =>
  b.engagedMs === null
    ? t("此前时长未单独记录")
    : t("实际投入 {v} 分钟", { v: Math.floor(b.engagedMs / 60000) });
</script>
<template>
  <section class="card day-agenda" :aria-label="t('今日时间表')">
    <div class="agenda-heading">
      <div>
        <span class="eyebrow">{{ agenda.date }}</span>
        <h2>{{ t("今日时间表") }}</h2>
      </div>
      <div class="agenda-range" role="group" :aria-label="t('时间表显示范围')">
        <button :aria-pressed="nearby" @click="nearby = true">
          {{ t("此刻附近") }}
        </button>
        <button :aria-pressed="!nearby" @click="nearby = false">
          {{ t("全天") }}
        </button>
      </div>
    </div>
    <p class="muted">{{ agenda.note }}</p>
    <div class="agenda-legend">
      <span class="legend-actual">{{ t("实际时段") }}</span
      ><span class="legend-plan">{{ t("选定的安排") }}</span
      ><span class="legend-free">{{ t("作息 / 空白") }}</span
      ><span class="legend-point">{{ t("● 伴随交流") }}</span>
    </div>
    <div class="agenda-chart">
      <div class="agenda-axis">
        <time
          v-for="(at, i) in ticks"
          :key="at"
          :style="{ left: (i * 100) / 6 + '%' }"
          >{{ clock(at) }}</time
        >
      </div>
      <div class="agenda-lane">
        <span class="lane-label">{{ t("已发生") }}</span>
        <div class="lane-track">
          <i
            v-for="(at, i) in ticks.slice(0, -1)"
            :key="at"
            class="gridline"
            :style="{ left: (i * 100) / 6 + '%' }"
          ></i>
          <button
            v-for="b in agenda.actual.filter(shown)"
            :key="b.id"
            class="agenda-block actual"
            :class="{ ongoing: b.ongoing }"
            :style="style(b)"
            :title="description(b) + ' · ' + investment(b)"
            :aria-label="description(b)"
            @click="emit('task', b.taskId)"
          ></button>
          <span
            v-for="p in agenda.interactions.filter(
              (p: any) => p.at >= windowRange[0] && p.at < windowRange[1],
            )"
            :key="p.id"
            class="agenda-interaction"
            :style="{ left: position(p.at) + '%' }"
            :title="clock(p.at) + t(' · 伴随交流')"
          ></span>
          <span
            v-if="position(agenda.now) >= 0 && position(agenda.now) <= 100"
            class="agenda-now"
            :style="{ left: position(agenda.now) + '%' }"
            ><small>{{ t("现在") }}</small></span
          >
        </div>
      </div>
      <div class="agenda-lane">
        <span class="lane-label">{{ t("接下来") }}</span>
        <div class="lane-track">
          <i
            v-for="(at, i) in ticks.slice(0, -1)"
            :key="at"
            class="gridline"
            :style="{ left: (i * 100) / 6 + '%' }"
          ></i>
          <template v-for="b in agenda.planned.filter(shown)" :key="b.id">
            <button
              v-if="b.taskId"
              class="agenda-block plan"
              :style="style(b)"
              :title="description(b)"
              :aria-label="description(b)"
              @click="emit('task', b.taskId)"
            ></button>
            <span
              v-else
              class="agenda-block"
              :class="b.kind"
              :style="style(b)"
              :title="description(b)"
            ></span>
          </template>
        </div>
      </div>
    </div>
    <details v-if="agenda.actual.length" class="agenda-history">
      <summary>
        {{
          t("已经走过的时段 · {length} 段", { length: agenda.actual.length })
        }}
      </summary>
      <ol class="agenda-itinerary">
        <li v-for="b in agenda.actual" :key="b.id">
          <time>{{ clock(b.start) }}<br />{{ clock(b.end) }}</time>
          <div>
            <button class="text-button" @click="emit('task', b.taskId)">
              {{ b.title }}</button
            ><small>{{ b.label }} · {{ investment(b) }}</small>
          </div>
        </li>
      </ol>
    </details>
    <p v-else class="faint">
      {{ t("今天还没有活动记录，实际开始后会显示在上方。") }}
    </p>
    <h3>{{ t("她定下的安排") }}</h3>
    <p v-if="!upcoming.length" class="faint">
      {{ t("还没有选定活动时间，留白由她再决定，不按待办队列填满。") }}
    </p>
    <ol class="agenda-itinerary">
      <li v-for="b in upcoming" :key="b.id" :data-kind="b.kind">
        <time>{{ clock(b.start) }}<br />{{ clock(b.end) }}</time>
        <div>
          <template v-if="b.taskId"
            ><button class="text-button" @click="emit('task', b.taskId)">
              {{ b.title }}</button
            ><small>{{
              t("{label} · {v} · {durationMinutes} 分钟 · {scope}", {
                label: b.label,
                v:
                  b.kindOfTask === "plan"
                    ? t("自己的安排")
                    : b.kindOfTask === "promise"
                      ? t("答应的事")
                      : t("外部建议"),
                durationMinutes: b.durationMinutes,
                scope: b.scope,
              })
            }}</small>
            <p v-if="b.why" class="muted">{{ b.why }}</p></template
          >
          <template v-else
            ><b>{{ b.title }}</b
            ><small>{{
              b.kind === "free"
                ? t("可以想自己的事，也可以歇着；不算已做过")
                : t("预计，做完眼前这段再调整")
            }}</small></template
          >
          <p v-if="b.interruptedAt" class="faint">
            {{ clock(b.interruptedAt) }}
            {{
              b.interruption === "sleep"
                ? t("进入睡眠安排，醒来后再选择续接时间。")
                : t("有更高优先级安排，届时先让位，之后再选续接时间。")
            }}
          </p>
        </div>
      </li>
    </ol>
    <p v-if="agenda.planned.some((b: any) => b.kind === 'sleep')" class="faint">
      {{
        t("睡眠安排：{v}", {
          v: agenda.planned
            .filter((b: any) => b.kind === "sleep")
            .map((b: any) => clock(b.start) + " — " + clock(b.end))
            .join("、"),
        })
      }}
    </p>
    <details v-if="agenda.unarranged?.length" class="agenda-waiting" open>
      <summary>
        {{
          t("已记下，还没选时间 · {length} 件", {
            length: agenda.unarranged.length,
          })
        }}
      </summary>
      <ul>
        <li v-for="item in agenda.unarranged" :key="item.id">
          <button class="text-button" @click="emit('task', item.id)">
            {{ item.title }}
          </button>
          <p class="muted">{{ item.reason }}</p>
        </li>
      </ul>
    </details>
    <details v-if="agenda.paused?.length" class="agenda-waiting" open>
      <summary>
        {{
          t("暂时停下来，进度保留 · {length} 件", {
            length: agenda.paused.length,
          })
        }}
      </summary>
      <ul>
        <li v-for="item in agenda.paused" :key="item.id">
          <button class="text-button" @click="emit('task', item.id)">
            {{ item.title }}
          </button>
          <p class="muted">{{ item.reason }}</p>
        </li>
      </ul>
    </details>
    <details v-if="agenda.waiting.length" class="agenda-waiting" open>
      <summary>
        {{
          t("需要条件或调整约定 · {length} 件", {
            length: agenda.waiting.length,
          })
        }}
      </summary>
      <ul>
        <li v-for="item in agenda.waiting" :key="item.id">
          <button class="text-button" @click="emit('task', item.id)">
            {{ item.title }}
          </button>
          <p class="muted">{{ item.reason }}</p>
        </li>
      </ul>
    </details>
  </section>
</template>
<style scoped>
.day-agenda {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.agenda-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
}
h2 {
  font-size: 24px;
  margin: 6px 0 0;
}
h3 {
  font-size: 16px;
}
p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.agenda-range {
  display: flex;
  gap: 6px;
}
.agenda-range button {
  padding: 8px 12px;
  font-size: 12px;
}
.agenda-range button[aria-pressed="true"] {
  background: var(--accent);
  color: white;
}
.agenda-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: var(--muted);
}
.agenda-legend span::before {
  content: "";
  display: inline-block;
  width: 16px;
  height: 8px;
  margin-right: 6px;
  border-radius: 3px;
}
.legend-actual::before {
  background: var(--accent);
}
.legend-plan::before {
  border: 1px dashed var(--accent);
  background: var(--glow-b);
}
.legend-free::before {
  background: rgba(125, 120, 149, 0.15);
}
.legend-point {
  color: var(--accent);
}
.legend-point::before {
  display: none !important;
}
.agenda-chart {
  padding: 18px 0 0;
  min-width: 0;
}
.agenda-axis {
  height: 28px;
  margin-left: 60px;
  position: relative;
  margin-right: 12px;
  font-size: 11px;
  color: var(--muted);
}
.agenda-axis time {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.agenda-axis time:first-child {
  transform: none;
}
.agenda-axis time:last-child {
  transform: translateX(-100%);
}
.agenda-lane {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr);
  align-items: center;
  gap: 0;
  margin-bottom: 14px;
  margin-right: 12px;
}
.lane-label {
  font-size: 11px;
  color: var(--muted);
}
.lane-track {
  height: 40px;
  position: relative;
  background: rgba(133, 128, 149, 0.06);
  border-radius: 8px;
}
.gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid rgba(125, 120, 149, 0.15);
  pointer-events: none;
}
.agenda-block {
  position: absolute;
  top: 7px;
  height: 26px;
  min-width: 1px;
  border-radius: 5px;
  padding: 0;
  box-shadow: none;
}
.actual {
  background: linear-gradient(100deg, var(--accent), var(--orb-b));
  border: none;
}
.ongoing {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.plan {
  border: 1px dashed var(--accent);
  background: var(--glow-b);
}
.rest,
.free {
  background: rgba(125, 120, 149, 0.12);
}
.free {
  background: repeating-linear-gradient(
    135deg,
    transparent,
    transparent 5px,
    rgba(125, 120, 149, 0.08) 5px,
    rgba(125, 120, 149, 0.08) 8px
  );
}
.sleep {
  background: rgba(114, 116, 161, 0.25);
}
.agenda-now {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 1px;
  background: var(--accent);
  pointer-events: none;
}
.agenda-now small {
  position: absolute;
  top: -18px;
  font-size: 10px;
  color: var(--accent);
  white-space: nowrap;
  transform: translateX(-50%);
}
.agenda-interaction {
  position: absolute;
  bottom: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateX(-50%);
}
.agenda-itinerary {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0;
  margin: 0;
}
.agenda-itinerary li {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 18px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(125, 120, 149, 0.12);
}
.agenda-itinerary time {
  font-size: 12px;
  line-height: 1.9;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.agenda-itinerary li > div {
  display: grid;
  gap: 5px;
  align-content: start;
  min-width: 0;
}
.agenda-itinerary button {
  text-align: left;
  justify-self: start;
  overflow-wrap: anywhere;
  line-height: 1.6;
  white-space: normal;
}
.agenda-itinerary small {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.8;
}
.agenda-itinerary b {
  font-size: 14px;
}
.agenda-itinerary p {
  font-size: 13px;
}
.agenda-itinerary [data-kind="free"],
.agenda-itinerary [data-kind="rest"] {
  color: var(--muted);
}
summary {
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.agenda-history ol,
.agenda-waiting ul {
  margin-top: 15px;
}
.agenda-waiting ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 16px;
}
@media (max-width: 440px) {
  .agenda-axis time:nth-child(even) {
    display: none;
  }
  .agenda-axis {
    margin-left: 46px;
  }
  .agenda-lane {
    grid-template-columns: 46px minmax(0, 1fr);
  }
  .agenda-axis time {
    font-size: 9px;
  }
  .agenda-itinerary li {
    grid-template-columns: 54px minmax(0, 1fr);
    gap: 12px;
  }
  .agenda-heading h2 {
    font-size: 21px;
  }
  .agenda-legend {
    gap: 10px;
  }
}
</style>
