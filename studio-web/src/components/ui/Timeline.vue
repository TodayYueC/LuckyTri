<script
  setup
  lang="ts"
  generic="T extends { id?: string | number; time?: number; tone?: string }"
>
defineProps<{ items: T[]; label: string }>();
</script>

<template>
  <ol class="timeline" :aria-label="label">
    <li
      v-for="(item, index) in items"
      :key="item.id ?? index"
      :data-tone="item.tone || undefined"
    >
      <span class="stem" aria-hidden="true"><i></i></span>
      <div class="entry"><slot :item="item" :index="index" /></div>
    </li>
  </ol>
</template>

<style scoped>
.timeline {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}
.timeline li {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
}
.stem {
  position: relative;
  display: grid;
  justify-items: center;
}
.stem::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.timeline li:first-child .stem::before {
  top: 12px;
}
.timeline li:last-child .stem::before {
  bottom: calc(100% - 14px);
}
.stem i {
  position: relative;
  width: 11px;
  height: 11px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--surface-strong);
  border: 2.5px solid var(--accent);
}
li[data-tone="warm"] .stem i {
  border-color: var(--cheek);
  background: var(--cheek);
}
li[data-tone="quiet"] .stem i {
  border-color: var(--ink-faint);
}
li[data-tone="glow"] .stem i {
  background: var(--accent);
}
li[data-tone="night"] .stem i {
  border-color: var(--orb-c);
  background: var(--orb-c);
}
.entry {
  min-width: 0;
  padding: 4px 0 14px;
}
</style>
