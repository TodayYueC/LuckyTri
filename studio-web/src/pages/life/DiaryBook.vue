<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { toast } from "../../api";
import { mind } from "../../plates/mind";
import { dayLabel, weekday } from "../../format";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{ diaries: any[] }>();
const index = ref(0);
const day = ref<any>(null);
const loadingDay = ref(false);

const entry = computed(() => props.diaries[index.value] || null);

watch(
  () => props.diaries,
  (list) => {
    if (index.value >= list.length) index.value = 0;
  },
);
watch(entry, () => {
  day.value = null;
});

async function openDay() {
  if (!entry.value) return;
  if (day.value?.day === entry.value.day) {
    day.value = null;
    return;
  }
  loadingDay.value = true;
  try {
    day.value = await mind.day(entry.value.day);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    loadingDay.value = false;
  }
}
</script>

<template>
  <div v-if="diaries.length" class="book">
    <nav class="days" aria-label="日记的日子">
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
            <span class="eyebrow">日记</span>
            <h2>
              {{ dayLabel(entry.day) }} <small>{{ weekday(entry.day) }}</small>
            </h2>
          </div>
          <span v-if="entry.mood" class="stamp" aria-label="那天的心情">{{
            entry.mood
          }}</span>
        </header>
        <p class="ink">{{ entry.content }}</p>
        <blockquote v-if="entry.compare">
          和昨天的自己比：{{ entry.compare }}
        </blockquote>
        <footer>
          <button
            :disabled="index >= diaries.length - 1"
            aria-label="前一天"
            @click="index += 1"
          >
            ‹ 前一天
          </button>
          <button class="primary" :disabled="loadingDay" @click="openDay">
            {{ day?.day === entry.day ? "合上那天的 TA" : "那天的 TA" }}
          </button>
          <button
            :disabled="index === 0"
            aria-label="后一天"
            @click="index -= 1"
          >
            后一天 ›
          </button>
        </footer>
        <section v-if="day?.day === entry.day" class="day-diff">
          <template v-if="day.change">
            <h3>那天的 TA，和前一天比</h3>
            <p v-if="day.change.appeared.length">
              <b>多了：</b
              >{{ day.change.appeared.map((t: any) => t.content).join("；") }}
            </p>
            <p v-if="day.change.changed.length">
              <b>变了：</b
              >{{
                day.change.changed
                  .map((t: any) => `${t.before.content} → ${t.content}`)
                  .join("；")
              }}
            </p>
            <p v-if="day.change.faded.length">
              <b>放下了：</b
              >{{ day.change.faded.map((t: any) => t.content).join("；") }}
            </p>
            <p>
              <b>心情：</b>{{ day.change.mood.before || "—" }} →
              {{ day.change.mood.after || "—" }}
            </p>
          </template>
          <p v-else class="muted">
            这是 TA 留下快照的第一天，还没有可以对照的昨天。
          </p>
        </section>
      </article>
    </Transition>
  </div>
  <Empty
    v-else
    title="还没有日记"
    text="每天睡前（或凌晨），如果这一天真的有过经历，TA 会写下来，并和昨天的自己对照。"
  />
</template>

<style scoped src="./DiaryBook.css"></style>
