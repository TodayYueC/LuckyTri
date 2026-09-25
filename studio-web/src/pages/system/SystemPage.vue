<script setup lang="ts">
import { ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import Tabs from "../../components/ui/Tabs.vue";
import ConnectQQ from "./ConnectQQ.vue";
import ModelLibrary from "./ModelLibrary.vue";
import Runtime from "./Runtime.vue";
import { ask } from "../../dialog";

const VIEWS = ["connect", "models", "runtime"];
const view = ref(VIEWS.includes(studio.sub) ? studio.sub : "connect");
async function switchView(next: string) {
  if (next === view.value) return;
  if (
    studio.dirty &&
    !(await ask("当前设置还没保存，离开这个分区吗？", {
      title: "未保存的修改",
      confirmText: "放弃修改",
      cancelText: "继续编辑",
    }))
  )
    return;
  studio.dirty = false;
  view.value = next;
}

watch(view, (next) => setSub(next));
watch(
  () => studio.sub,
  (sub) => {
    if (VIEWS.includes(sub)) view.value = sub;
  },
);
</script>

<template>
  <div class="page system">
    <header class="system-intro">
      <div>
        <span class="eyebrow">THE WORLD AROUND HER · 系统</span>
        <h1>让她与世界，<em>温柔相连。</em></h1>
        <p>连接、模型与运行方式都在这里。每一处改变，都可以看见结果。</p>
      </div>
      <span class="system-status">
        <i :class="{ off: !studio.health.connection?.online }"></i>
        {{
          studio.health.connection?.online ? "正在与 QQ 相连" : "等待 QQ 连接"
        }}
      </span>
    </header>
    <Tabs
      :model-value="view"
      @update:model-value="switchView"
      label="系统的分区"
      :items="[
        { key: 'connect', label: '连接 QQ' },
        { key: 'models', label: '模型库' },
        { key: 'runtime', label: '运行开关' },
      ]"
    />
    <ConnectQQ v-if="view === 'connect'" @open="switchView" />
    <ModelLibrary v-else-if="view === 'models'" />
    <Runtime v-else />
  </div>
</template>

<style scoped>
.system {
  display: grid;
  gap: var(--gap);
}
.system-intro {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  min-height: 190px;
  padding: 32px clamp(26px, 5vw, 60px);
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.85);
  border-radius: 36px;
  background:
    radial-gradient(
      ellipse at 90% 7%,
      color-mix(in srgb, var(--glow-a) 48%, transparent),
      transparent 51%
    ),
    radial-gradient(
      ellipse at 62% 115%,
      color-mix(in srgb, var(--glow-b) 38%, transparent),
      transparent 55%
    ),
    linear-gradient(115deg, rgb(255 255 255 / 0.8), rgb(255 255 255 / 0.3));
  box-shadow:
    inset 0 2px 0 white,
    0 25px 54px -35px color-mix(in srgb, var(--accent) 43%, transparent);
  backdrop-filter: blur(28px) saturate(1.8);
}
.system-intro::before {
  content: "";
  position: absolute;
  right: 13%;
  top: -85%;
  width: 350px;
  height: 350px;
  border: 1px solid rgb(255 255 255 / 0.72);
  border-radius: 50%;
  box-shadow:
    0 0 0 29px rgb(255 255 255 / 0.13),
    0 0 0 58px color-mix(in srgb, var(--glow-b) 12%, transparent);
  pointer-events: none;
  animation: system-bob 10s ease-in-out infinite alternate;
}
.system-intro h1 {
  margin: 10px 0 7px;
  font-size: clamp(28px, 3.25vw, 42px);
  letter-spacing: -0.055em;
}
.system-intro h1 em {
  font-style: normal;
  color: var(--accent);
}
.system-intro p {
  position: relative;
  max-width: 560px;
  color: var(--ink-soft);
  font-size: 13.5px;
}
.system-status {
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 10px 16px;
  border: 1px solid white;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.53);
  box-shadow:
    inset 0 1px 0 white,
    0 7px 19px -15px var(--accent);
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  backdrop-filter: blur(20px);
}
.system-status i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent);
  animation: pulse-soft 2.6s ease-in-out infinite;
}
.system-status i.off {
  background: var(--ink-faint);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ink-faint) 14%, transparent);
  animation: none;
}
.system > .tabs {
  justify-self: start;
  padding: 5px;
  border: 1px solid rgb(255 255 255 / 0.8);
  box-shadow:
    inset 0 1px 0 white,
    0 10px 30px -24px var(--accent);
  backdrop-filter: blur(22px) saturate(1.7);
}
.system > :deep(.tabs button) {
  padding: 9px 18px;
  border-radius: 999px;
  transition:
    transform 0.35s var(--spring),
    background-color 0.2s,
    box-shadow 0.2s;
}
.system > :deep(.tabs button:hover) {
  transform: translateY(-2px) scale(1.03);
}
.system :deep(.connect .step),
.system :deep(.connect .checks li) {
  border: 1px solid rgb(255 255 255 / 0.85);
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgb(255 255 255 / 0.68), rgb(255 255 255 / 0.28)),
    var(--surface);
  box-shadow:
    inset 0 1px 0 white,
    0 12px 24px -24px var(--accent);
  backdrop-filter: blur(18px) saturate(1.55);
  transition:
    transform 0.35s var(--spring),
    box-shadow 0.25s;
}
.system :deep(.connect .step:hover),
.system :deep(.connect .checks li:hover) {
  transform: translateY(-3px);
  box-shadow:
    inset 0 1px 0 white,
    0 16px 28px -21px var(--accent);
}
.system :deep(.connect .num) {
  background: linear-gradient(
    145deg,
    white,
    color-mix(in srgb, var(--glow-a) 75%, white)
  );
  border: 1px solid white;
  box-shadow:
    inset 0 1px 0 white,
    0 5px 14px -9px var(--accent);
  color: var(--accent);
}
@keyframes system-bob {
  to {
    transform: translateY(22px) scale(1.08);
  }
}
@media (max-width: 760px) {
  .system-intro {
    min-height: 0;
    padding: 27px 23px;
  }
}
</style>
