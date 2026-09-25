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
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  content-visibility: auto;
  contain-intrinsic-size: auto 84px;
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
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(
    var(--glow-a),
    rgb(255 255 255 / 0.85),
    var(--glow-b)
  );
  box-shadow: 0 0 10px color-mix(in srgb, var(--glow-a) 55%, transparent);
}
.timeline li:first-child .stem::before {
  top: 12px;
}
.timeline li:last-child .stem::before {
  bottom: calc(100% - 14px);
}
.stem i {
  position: relative;
  width: 13px;
  height: 13px;
  margin-top: 18px;
  border-radius: 50%;
  background: linear-gradient(145deg, white, var(--glow-a));
  border: 2px solid white;
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--accent) 33%, transparent),
    0 0 13px var(--glow-a);
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
  margin-bottom: 10px;
  padding: 11px 15px;
  border: 1px solid rgb(255 255 255 / 0.76);
  border-radius: 18px;
  background:
    linear-gradient(125deg, rgb(255 255 255 / 0.66), rgb(255 255 255 / 0.2)),
    var(--glass-fill);
  box-shadow:
    inset 0 1px 0 white,
    0 8px 21px -18px var(--accent);
  transition: transform 480ms var(--jelly);
}
.timeline li:hover .entry {
  transform: translateX(4px) scale(1.01);
}
</style>
