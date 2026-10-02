<script setup lang="ts">
import { t } from "../../i18n";
import { computed, ref, watch } from "vue";
import { toast } from "../../api";
import { mind } from "../../plates/mind";
import { go } from "../../stores/studio";
import { dayLabel, weekday } from "../../format";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{ diaries: any[] }>();
const index = ref(0);
const day = ref<any>(null);
const loadingDay = ref(false);
let dayRequest = 0;

const entry = computed(() => props.diaries[index.value] || null);

watch(
  () => props.diaries,
  (list) => {
    if (index.value >= list.length) index.value = 0;
  },
);
watch(
  () => entry.value?.id,
  () => {
    dayRequest++;
    day.value = null;
    loadingDay.value = false;
  },
);

async function openDay() {
  if (!entry.value) return;
  const selectedDay = entry.value.day,
    request = ++dayRequest;
  if (day.value?.day === entry.value.day) {
    day.value = null;
    return;
  }
  loadingDay.value = true;
  try {
    const result = await mind.day(selectedDay);
    if (request === dayRequest && entry.value?.day === selectedDay)
      day.value = result;
  } catch (error) {
    if (request === dayRequest) toast((error as Error).message, true);
  } finally {
    if (request === dayRequest) loadingDay.value = false;
  }
}
</script>

<template>
  <div v-if="diaries.length" class="book">
    <nav class="days" :aria-label="t('日记的日子')">
      <button
        v-for="(d, i) in diaries"
        :key="d.id"
        class="diary-day"
        :class="{ active: i === index }"
        :data-day="d.day"
        :aria-current="i === index ? 'true' : undefined"
        @click="index = i"
      >
        <b>{{ dayLabel(d.day) }}</b>
        <small>{{ weekday(d.day) }}{{ d.mood ? ` · ${d.mood}` : "" }}</small>
      </button>
    </nav>
    <Transition name="page-turn" mode="out-in">
      <article v-if="entry" :key="entry.id" class="diary-page">
        <header>
          <div>
            <span class="eyebrow">{{ t("日记") }}</span>
            <h2>
              {{ dayLabel(entry.day) }} <small>{{ weekday(entry.day) }}</small>
            </h2>
          </div>
          <span v-if="entry.mood" class="stamp" :aria-label="t('那天的心情')">{{
            entry.mood
          }}</span>
        </header>
        <p class="ink">{{ entry.content }}</p>
        <div v-if="entry.actions?.length" class="row">
          <button
            v-for="action in entry.actions"
            :key="action.ref"
            class="text-button"
            @click="go('time', action.work ? 'works/' + action.work : 'tasks')"
          >
            {{ action.title }} →
          </button>
        </div>
        <blockquote v-if="entry.compare">
          {{ t("和昨天的自己比：{compare}", { compare: entry.compare }) }}
        </blockquote>
        <footer>
          <button
            :disabled="index >= diaries.length - 1"
            :aria-label="t('前一天')"
            @click="index += 1"
          >
            {{ t("‹ 前一天") }}
          </button>
          <button class="primary" :disabled="loadingDay" @click="openDay">
            {{ day?.day === entry.day ? t("合上那天的 TA") : t("那天的 TA") }}
          </button>
          <button
            :disabled="index === 0"
            :aria-label="t('后一天')"
            @click="index -= 1"
          >
            {{ t("后一天 ›") }}
          </button>
        </footer>
        <section v-if="day?.day === entry.day" class="day-diff">
          <template v-if="day.change">
            <h3>{{ t("那天的 TA，和前一天比") }}</h3>
            <p v-if="day.change.appeared.length">
              <b>{{ t("多了：") }}</b
              >{{
                day.change.appeared
                  .map((change: any) => change.content)
                  .join("；")
              }}
            </p>
            <p v-if="day.change.changed.length">
              <b>{{ t("变了：") }}</b
              >{{
                day.change.changed
                  .map(
                    (change: any) =>
                      `${change.before.content} → ${change.content}`,
                  )
                  .join("；")
              }}
            </p>
            <p v-if="day.change.faded.length">
              <b>{{ t("放下了：") }}</b
              >{{
                day.change.faded.map((change: any) => change.content).join("；")
              }}
            </p>
            <p v-if="day.change.livingFor">
              <b>{{ t("正在过的：") }}</b
              >{{ day.change.livingFor.from || t("还没有") }} →
              {{ day.change.livingFor.to || t("还没有") }}
            </p>
            <p v-else-if="day.snapshot?.livingFor?.content">
              <b>{{ t("正在过的：") }}</b
              >{{ day.snapshot.livingFor.content }}
            </p>
            <p>
              <b>{{ t("心情：") }}</b
              >{{ day.change.mood.before || "—" }} →
              {{ day.change.mood.after || "—" }}
            </p>
          </template>
          <p v-else class="muted">
            {{ t("这是 TA 留下快照的第一天，还没有可以对照的昨天。") }}
          </p>
        </section>
      </article>
    </Transition>
  </div>
  <Empty
    v-else
    :title="t('还没有日记')"
    :text="
      t(
        '每天睡前（或凌晨），如果这一天真的有过经历，TA 会写下来，并和昨天的自己对照。',
      )
    "
  />
</template>

<style scoped src="./DiaryBook.css"></style>
