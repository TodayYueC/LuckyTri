<script setup lang="ts">
import { computed } from "vue";
import { dateFormatter } from "../../formatters";
import Empty from "../../components/ui/Empty.vue";
const props = defineProps<{ rows: any[]; zone: string; loading: boolean }>();
const emit = defineEmits<{
  work: [id: string, version: number];
  project: [id: string];
  source: [id: string];
}>();
const days = computed(() => {
  const formatter = dateFormatter("zh-CN", {
    timeZone: props.zone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const groups: { date: string; rows: any[] }[] = [];
  for (const row of props.rows) {
    const date = formatter.format(row.created);
    if (groups.at(-1)?.date !== date) groups.push({ date, rows: [] });
    groups.at(-1)!.rows.push(row);
  }
  return groups;
});
function clock(time: number) {
  return dateFormatter("zh-CN", {
    timeZone: props.zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(time);
}
</script>

<template>
  <section class="experience-log" aria-label="体验记录">
    <header class="experience-intro">
      <div>
        <span class="eyebrow">EXPERIENCES · 留下的经历</span>
        <h1>最近做过的事</h1>
      </div>
      <p>故事写到哪里，玩过什么，又留下了哪些想法。</p>
    </header>
    <section v-for="day in days" :key="day.date" class="experience-day">
      <h2 class="experience-date">{{ day.date }}</h2>
      <div class="experience-timeline">
        <article
          v-for="row in day.rows"
          :key="row.id"
          class="experience-entry"
          :data-experience="row.id"
        >
          <time
            class="experience-clock"
            :datetime="new Date(row.created).toISOString()"
            >{{ clock(row.created) }}</time
          >
          <div class="card experience-card">
            <div class="experience-meta">
              <span class="experience-kind">{{ row.label }}记录</span
              ><span v-if="row.work" class="faint"
                >{{
                  row.work.state === "complete" ? "已保存成果" : "已保存草稿"
                }}
                · {{ row.work.characters }} 字 · 版本
                {{ row.work.version }}</span
              >
            </div>
            <h3>{{ row.title }}</h3>
            <p v-if="row.summary" class="experience-summary">
              {{ row.summary }}
            </p>
            <p v-else class="faint experience-missing">
              这条旧记录没有保存摘要。
            </p>
            <p
              v-if="row.project?.title && row.project.title !== row.title"
              class="experience-project faint"
            >
              来自 {{ row.project.title }}
            </p>
            <div v-if="row.work || row.project" class="experience-actions">
              <button
                v-if="row.work"
                @click="emit('work', row.work.id, row.work.version)"
              >
                {{ row.activity === "write" ? "阅读这一稿" : "阅读完整记录"
                }}<span aria-hidden="true"> →</span>
              </button>
              <button
                v-if="row.project"
                class="text-button"
                @click="emit('project', row.project.id)"
              >
                查看项目
              </button>
            </div>
            <details v-if="row.materials?.length" class="experience-materials">
              <summary>接触的内容 · {{ row.materials.length }} 份</summary>
              <ul>
                <li v-for="item in row.materials" :key="item.id">
                  <button class="text-button" @click="emit('source', item.id)">
                    {{ item.title || "未命名资料" }}
                  </button>
                </li>
              </ul>
            </details>
          </div>
        </article>
      </div>
    </section>
    <Empty
      v-if="!loading && !rows.length"
      title="这里还没有经历记录"
      text="做过的事与保存的成果，会逐渐出现在这里。"
    />
    <details class="experience-capability">
      <summary>游戏客户端连接 <span class="faint">开发中</span></summary>
      <p class="muted">客户端控制尚未接入。已有的游玩记录可以在上方阅读。</p>
    </details>
  </section>
</template>

<style scoped>
.experience-log {
  display: grid;
  gap: 28px;
  min-width: 0;
}
.experience-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding: 4px 4px 0;
}
.experience-intro h1 {
  margin-top: 8px;
  font-size: clamp(25px, 2.4vw, 32px);
  letter-spacing: -0.03em;
}
.experience-intro p {
  max-width: 330px;
  color: var(--muted);
  line-height: 1.7;
  font-size: 14px;
}
.experience-day {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.experience-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  padding-left: 4px;
}
.experience-timeline {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.experience-entry {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 18px;
  position: relative;
}
.experience-entry::before {
  content: "";
  position: absolute;
  top: 48px;
  bottom: -18px;
  left: 29px;
  width: 1px;
  background: var(--line);
}
.experience-entry:last-child::before {
  bottom: 0;
}
.experience-clock {
  padding-top: 25px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--muted);
}
.experience-card.card {
  min-width: 0;
  display: grid;
  gap: 12px;
  padding: 24px 28px;
  border-radius: 24px;
}
.experience-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 12px;
}
.experience-kind {
  color: var(--accent);
  font-weight: 600;
}
.experience-card h3 {
  font-size: 21px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.experience-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.85;
  white-space: normal;
  overflow-wrap: anywhere;
}
.experience-project,
.experience-missing {
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.experience-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 20px;
}
.experience-actions button {
  font-size: 13px;
}
.experience-materials {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  min-width: 0;
}
.experience-materials summary {
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.experience-materials ul {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding-left: 18px;
}
.experience-materials button {
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
}
.experience-capability {
  margin-left: 76px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: 18px;
  font-size: 12px;
}
.experience-capability summary {
  cursor: pointer;
}
.experience-capability summary span {
  margin-left: 12px;
}
.experience-capability p {
  margin-top: 12px;
  line-height: 1.75;
}
@media (max-width: 760px) {
  .experience-intro {
    display: grid;
    gap: 10px;
  }
  .experience-intro p {
    max-width: none;
  }
  .experience-entry {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .experience-entry::before {
    display: none;
  }
  .experience-clock {
    padding: 0 4px;
    text-align: left;
  }
  .experience-card.card {
    padding: 20px;
  }
  .experience-card h3 {
    font-size: 19px;
  }
  .experience-capability {
    margin-left: 0;
  }
}
</style>
