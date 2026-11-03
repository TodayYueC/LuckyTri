<script setup lang="ts">
import Icon from "./Icon.vue";
const model = defineModel<string>({ required: true });
const props = defineProps<{
  label: string;
  items: {
    key: string;
    label: string;
    count?: string | number;
    icon?: string;
  }[];
}>();
const icons: Record<string, string> = {
  schedule: "time",
  diary: "life",
  ahead: "time",
  creation: "nature",
  review: "memory",
  archive: "memory",
  knowledge: "life",
  reading: "life",
  connect: "people",
  models: "heart",
  stickers: "now",
  media: "chats",
  settings: "system",
  storage: "memory",
  profile: "now",
  growth: "nature",
  days: "time",
  prompts: "chats",
  stars: "heart",
  list: "layout",
  notes: "life",
  galaxy: "people",
  groups: "chats",
  relationships: "people",
  installed: "layout",
  market: "search",
  actions: "system",
  import: "plus",
};
function move(event: KeyboardEvent) {
  const index = props.items.findIndex((i) => i.key === model.value);
  const delta = ["ArrowRight", "ArrowDown"].includes(event.key)
    ? 1
    : ["ArrowLeft", "ArrowUp"].includes(event.key)
      ? -1
      : 0;
  if (!delta && !["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next =
    props.items[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? props.items.length - 1
          : (index + delta + props.items.length) % props.items.length
    ];
  model.value = next.key;
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)
    ?.focus();
}
</script>
<template>
  <nav class="section-nav" role="tablist" :aria-label="label">
    <button
      v-for="item in items"
      :key="item.key"
      role="tab"
      type="button"
      :data-tab="item.key"
      :aria-selected="model === item.key"
      :tabindex="model === item.key ? 0 : -1"
      @click="model = item.key"
      @keydown="move"
    >
      <span class="section-icon"
        ><Icon :name="item.icon || icons[item.key] || 'layout'"
      /></span>
      <span>{{ item.label }}</span
      ><small v-if="item.count !== undefined && item.count !== ''">{{
        item.count
      }}</small>
    </button>
  </nav>
</template>
<style scoped>
.section-nav {
  display: flex;
  gap: 10px;
  min-width: 0;
  width: 100%;
  flex: none;
  overflow: auto;
  padding: 1px 1px 5px;
  scrollbar-width: thin;
}
.section-nav button {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 0 auto;
  justify-content: flex-start;
  min-height: 58px;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  color: var(--ink-soft);
  box-shadow: none;
  white-space: nowrap;
}
.section-nav button[aria-selected="true"] {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  background: color-mix(in srgb, var(--accent-soft) 42%, var(--surface));
}
.section-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
}
.section-icon .icon {
  width: 20px;
  height: 20px;
}
.section-nav small {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 680px) {
  .section-nav {
    gap: 8px;
  }
  .section-nav button {
    min-height: 48px;
    padding: 9px 12px;
    gap: 6px;
    font-size: 12px;
  }
  .section-icon {
    width: 20px;
  }
}
</style>
