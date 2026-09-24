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
            <span class="eyebrow">DIARY</span>
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

<style scoped>
.book {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}
.days {
  display: grid;
  gap: 6px;
  max-height: 640px;
  overflow: auto;
  padding: 4px;
}
.diary-day {
  display: grid;
  justify-items: start;
  gap: 1px;
  padding: 10px 14px;
  border-radius: 14px;
  text-align: left;
  background: var(--surface);
}
.diary-day small {
  color: var(--ink-soft);
  font-size: 11.5px;
  font-weight: 500;
}
.diary-day.active {
  background: var(--paper);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: var(--shadow-soft);
}
.diary-page {
  position: relative;
  display: grid;
  gap: 16px;
  min-height: 420px;
  padding: 30px 34px 24px 56px;
  border-radius: 8px 22px 22px 8px;
  background:
    linear-gradient(
      90deg,
      transparent 38px,
      color-mix(in srgb, var(--cheek) 45%, transparent) 38px,
      color-mix(in srgb, var(--cheek) 45%, transparent) 40px,
      transparent 40px
    ),
    repeating-linear-gradient(transparent 0 31px, var(--paper-line) 31px 32px),
    var(--paper);
  box-shadow:
    var(--shadow),
    inset 10px 0 18px -14px rgb(0 0 0 / 0.25);
}
.diary-page header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.diary-page h2 {
  font-size: 22px;
}
.diary-page h2 small {
  font-size: 14px;
  color: var(--ink-soft);
}
.stamp {
  display: grid;
  place-items: center;
  flex: none;
  width: 84px;
  height: 84px;
  padding: 8px;
  border: 3px double var(--accent);
  border-radius: 50%;
  color: var(--accent);
  font: 700 15px/1.2 var(--font-display);
  text-align: center;
  transform: rotate(-12deg);
  opacity: 0.85;
}
.ink {
  font-size: 16px;
  line-height: 32px;
  white-space: pre-wrap;
}
blockquote {
  margin: 0;
  padding: 10px 16px;
  border-left: 3px solid var(--accent);
  border-radius: 0 12px 12px 0;
  background: color-mix(in srgb, var(--accent-soft) 70%, transparent);
  font-size: 14px;
}
.diary-page footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.day-diff {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 80%, transparent);
  border: 1px dashed var(--line);
  font-size: 14px;
}
.day-diff h3 {
  font-size: 14px;
}
.page-turn-enter-active {
  transition:
    opacity 0.3s var(--ease),
    transform 0.45s var(--spring);
}
.page-turn-leave-active {
  transition: opacity 0.15s;
}
.page-turn-enter-from {
  opacity: 0;
  transform: perspective(900px) rotateY(-8deg) translateX(10px);
  transform-origin: left center;
}
.page-turn-leave-to {
  opacity: 0;
}
@media (max-width: 900px) {
  .book {
    grid-template-columns: minmax(0, 1fr);
  }
  .days {
    display: flex;
    max-height: none;
    overflow-x: auto;
  }
  .diary-day {
    flex: 0 0 auto;
  }
  .diary-page {
    padding: 22px 18px 18px 40px;
    background:
      linear-gradient(
        90deg,
        transparent 26px,
        color-mix(in srgb, var(--cheek) 45%, transparent) 26px,
        color-mix(in srgb, var(--cheek) 45%, transparent) 28px,
        transparent 28px
      ),
      repeating-linear-gradient(
        transparent 0 31px,
        var(--paper-line) 31px 32px
      ),
      var(--paper);
  }
  .stamp {
    width: 64px;
    height: 64px;
    font-size: 12px;
  }
}
</style>
