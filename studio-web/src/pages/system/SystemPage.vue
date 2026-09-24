<script setup lang="ts">
import { ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import Tabs from "../../components/ui/Tabs.vue";
import ConnectQQ from "./ConnectQQ.vue";
import ModelLibrary from "./ModelLibrary.vue";
import Runtime from "./Runtime.vue";

const VIEWS = ["connect", "models", "runtime"];
const view = ref(VIEWS.includes(studio.sub) ? studio.sub : "connect");

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
    <Tabs
      v-model="view"
      label="系统的分区"
      :items="[
        { key: 'connect', label: '连接 QQ' },
        { key: 'models', label: '模型库' },
        { key: 'runtime', label: '运行开关' },
      ]"
    />
    <ConnectQQ v-if="view === 'connect'" @open="view = $event" />
    <ModelLibrary v-else-if="view === 'models'" />
    <Runtime v-else />
  </div>
</template>

<style scoped>
.system {
  display: grid;
  gap: var(--gap);
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--accent) 6%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--accent) 6%, transparent) 1px,
      transparent 1px
    );
  background-size: 28px 28px;
  background-position: -1px -1px;
  border-radius: var(--r-l);
}
.system > .tabs {
  justify-self: start;
}
</style>
