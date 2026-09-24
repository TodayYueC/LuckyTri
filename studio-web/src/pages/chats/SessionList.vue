<script setup lang="ts">
import { computed, ref } from "vue";
import { hueOf } from "../../format";

const props = defineProps<{
  sessions: any[];
  selected: string;
  unread: Record<string, number>;
}>();
const emit = defineEmits<{
  select: [id: string];
  add: [];
  toggle: [session: any];
  restore: [id: string];
  remove: [id: string];
}>();
const query = ref("");

const active = computed(() =>
  props.sessions.filter(
    (s) =>
      !s.archived &&
      `${s.name} ${s.id}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const archived = computed(() => props.sessions.filter((s) => s.archived));
</script>

<template>
  <div class="session-list">
    <div class="list-head">
      <h2>
        会话 <small>{{ active.length }}</small>
      </h2>
      <button class="small primary" @click="emit('add')">＋ 添加会话</button>
    </div>
    <input
      v-model="query"
      type="search"
      placeholder="搜索名称或号码"
      aria-label="搜索会话"
    />
    <div class="rows scroll-pane">
      <div
        v-for="s in active"
        :key="s.id"
        class="session-row"
        :class="{ selected: s.id === selected, paused: !s.enabled }"
      >
        <button
          class="row-main"
          :aria-current="s.id === selected ? 'true' : undefined"
          @click="emit('select', s.id)"
        >
          <span class="badge" :style="{ '--hue': hueOf(s.id) }">{{
            s.kind === "private" ? "私" : "群"
          }}</span>
          <span class="who">
            <b>{{ s.name }}</b>
            <small>{{ s.enabled ? "参与中" : "已暂停" }}</small>
          </span>
          <span
            v-if="unread[s.id]"
            class="unread"
            :aria-label="`${unread[s.id]} 条没细看`"
            >{{ unread[s.id] }}</span
          >
        </button>
        <label class="mini-switch" :title="s.enabled ? '暂停参与' : '开启参与'">
          <input
            type="checkbox"
            :checked="s.enabled"
            :aria-label="`参与：${s.name}`"
            @change="emit('toggle', s)"
          />
        </label>
      </div>
      <p v-if="!active.length" class="muted empty-line">暂无匹配的会话。</p>
      <details v-if="archived.length" class="archive-list">
        <summary>已归档 · {{ archived.length }}</summary>
        <article v-for="s in archived" :key="s.id">
          <b>{{ s.name }}</b>
          <div class="row">
            <button
              class="small"
              :data-restore-session="s.id"
              @click="emit('restore', s.id)"
            >
              恢复
            </button>
            <button
              class="small danger"
              :data-delete-session="s.id"
              @click="emit('remove', s.id)"
            >
              永久删除
            </button>
          </div>
        </article>
      </details>
    </div>
  </div>
</template>

<style scoped>
.session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  height: 100%;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.list-head h2 {
  font-size: 16px;
}
.list-head small {
  color: var(--ink-soft);
  font-size: 12px;
}
.session-list input[type="search"] {
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
}
.rows {
  flex: 1;
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  margin: 0 -6px;
  padding: 0 6px;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 8px;
  border-radius: 16px;
  transition: background-color 0.2s;
}
.session-row:hover {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.session-row.selected {
  background: var(--accent-soft);
}
.row-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 6px 8px 8px;
  border: none;
  background: transparent;
  text-align: left;
}
.row-main:hover:not(:disabled) {
  transform: none;
  box-shadow: none;
}
.badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 14px;
  background: hsl(var(--hue) 70% 88%);
  color: hsl(var(--hue) 45% 25%);
  font-weight: 700;
}
.who {
  display: grid;
  min-width: 0;
  line-height: 1.35;
}
.who b {
  overflow: hidden;
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who small {
  color: var(--ink-soft);
  font-size: 11.5px;
  font-weight: 500;
}
.paused .badge {
  filter: grayscale(0.7);
  opacity: 0.7;
}
.unread {
  flex: none;
  min-width: 20px;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--cheek);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.mini-switch input {
  appearance: none;
  position: relative;
  width: 30px;
  height: 18px;
  margin: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 18%, transparent);
  cursor: pointer;
  transition: background-color 0.2s;
}
.mini-switch input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--surface-strong);
  transition: transform 0.25s var(--spring);
}
.mini-switch input:checked {
  background: var(--accent);
}
.mini-switch input:checked::after {
  transform: translateX(12px);
}
.empty-line {
  padding: 12px 8px;
  font-size: 13px;
}
.archive-list {
  margin-top: 10px;
  padding: 10px 8px;
  border-top: 1px dashed var(--line);
  font-size: 13px;
}
.archive-list summary {
  color: var(--ink-soft);
  font-weight: 600;
}
.archive-list article {
  display: grid;
  gap: 6px;
  padding: 8px 0;
}
</style>
