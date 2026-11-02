<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { t } from "../../i18n";

const props = withDefaults(defineProps<{ title: string; width?: number }>(), { width: 340 });
const open = defineModel<boolean>({ default: false });
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const id = useId();
let listening = false;

function position() {
  if (!trigger.value || !panel.value) return;
  const box = trigger.value.getBoundingClientRect();
  const width = Math.min(props.width, window.innerWidth - 24);
  const left = Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12));
  panel.value.style.width = `${width}px`;
  panel.value.style.left = `${left}px`;
  panel.value.style.top = `${Math.min(box.bottom + 12, window.innerHeight - 100)}px`;
  panel.value.style.maxHeight = `${Math.max(80, window.innerHeight - box.bottom - 28)}px`;
}
function events(enabled: boolean) {
  if (enabled === listening) return;
  listening = enabled;
  const fn = enabled ? "addEventListener" : "removeEventListener";
  window[fn]("resize", position);
  window[fn]("scroll", position, true);
}
function toggled(event: Event) {
  open.value = (event as ToggleEvent).newState === "open";
  events(open.value);
}
function close() {
  open.value = false;
  trigger.value?.focus({ preventScroll: true });
}
watch(open, async (show) => {
  await nextTick();
  if (!panel.value) return;
  if (show) {
    position();
    panel.value.showPopover();
    panel.value.focus({ preventScroll: true });
  } else if (panel.value.matches(":popover-open")) panel.value.hidePopover();
});
onBeforeUnmount(() => events(false));
</script>

<template>
  <button ref="trigger" type="button" class="popover-trigger" :aria-label="title" :aria-expanded="open" :aria-controls="id" aria-haspopup="dialog" @click="open = !open">
    <slot name="trigger" />
  </button>
  <Teleport to="body">
    <section :id="id" ref="panel" popover="auto" class="control-popover" role="dialog" :aria-label="title" tabindex="-1" @toggle="toggled" @keydown.esc.stop.prevent="close">
      <header class="control-popover-head"><h2>{{ title }}</h2><button type="button" class="icon-button ghost" :aria-label="t('关闭')" @click="close">×</button></header>
      <div class="control-popover-body"><slot :close="close" /></div>
    </section>
  </Teleport>
</template>

<style scoped>
.popover-trigger { display:flex; align-items:center; justify-content:center; gap:9px; min-width:42px; min-height:42px; padding:9px 12px; border-radius:50px; background:var(--surface-strong); border:1px solid var(--line); box-shadow:var(--shadow-soft); }
.popover-trigger[aria-expanded="true"] { color:var(--accent); background:var(--accent-soft); }
.control-popover { position:fixed; inset:auto; margin:0; padding:0; overflow:auto; overscroll-behavior:contain; color:var(--ink); background:var(--surface-strong); border:1px solid var(--line); border-radius:24px; box-shadow:0 22px 70px -20px rgb(33 37 66 / .28); transform-origin:top right; }
.control-popover:popover-open { animation:control-open .28s var(--ease); }
.control-popover::backdrop { background:transparent; }
.control-popover-head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px 8px; }
.control-popover-head h2 { font-size:16px; font-weight:600; }
.control-popover-body { padding:8px 20px 20px; }
@keyframes control-open { from { opacity:0; transform:translateY(-8px) scale(.95); } to { opacity:1; transform:none; } }
</style>
