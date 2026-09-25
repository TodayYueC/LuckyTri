<script setup lang="ts">
import { computed, ref } from "vue";
import { hueOf, placeName } from "../../format";

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
          :data-pick="s.id"
          :aria-current="s.id === selected ? 'true' : undefined"
          @click="emit('select', s.id)"
        >
          <span class="badge" :style="{ '--hue': hueOf(s.id) }">{{
            s.kind === "private" ? "私" : "群"
          }}</span>
          <span class="who">
            <b>{{ placeName(s) }}</b>
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
            :aria-label="`参与：${placeName(s)}`"
            @change="emit('toggle', s)"
          />
        </label>
      </div>
      <p v-if="!active.length" class="muted empty-line">暂无匹配的会话。</p>
      <details v-if="archived.length" class="archive-list">
        <summary>已归档 · {{ archived.length }}</summary>
        <article v-for="s in archived" :key="s.id">
          <b>{{ placeName(s) }}</b>
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
  gap: 14px;
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
  font-size: 19px;
  letter-spacing: -0.04em;
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
  gap: 8px;
  min-height: 0;
  margin: 0 -6px;
  padding: 0 6px;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 8px;
  border: 1px solid rgb(255 255 255 / 0.62);
  border-radius: 19px;
  background: rgb(255 255 255 / 0.35);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.82);
  backdrop-filter: blur(16px) saturate(1.55);
  transition:
    transform 0.35s var(--spring),
    background-color 0.2s,
    box-shadow 0.25s,
    border-color 0.25s;
}
.session-row:hover {
  transform: translateX(4px) scale(1.015);
  background: rgb(255 255 255 / 0.66);
  box-shadow: 0 12px 24px -20px
    color-mix(in srgb, var(--accent) 52%, transparent);
}
.session-row.selected {
  border-color: color-mix(in srgb, var(--accent) 25%, white);
  background: linear-gradient(
    115deg,
    rgb(255 255 255 / 0.84),
    color-mix(in srgb, var(--accent-soft) 58%, transparent)
  );
  box-shadow:
    inset 0 1px 0 white,
    0 11px 24px -18px var(--accent);
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
  border-radius: 16px;
  background: linear-gradient(
    145deg,
    rgb(255 255 255 / 0.85),
    hsl(var(--hue) 72% 87%)
  );
  color: hsl(var(--hue) 45% 25%);
  font-weight: 700;
  box-shadow:
    inset 0 1px 0 white,
    0 6px 16px -10px hsl(var(--hue) 55% 45%);
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
