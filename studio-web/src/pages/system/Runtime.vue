<script setup lang="ts">
import { computed, ref } from "vue";
import { toast } from "../../api";
import { go, studio } from "../../stores/studio";
import { fetchState, patchSettings } from "../../plates/workspace";
import Toggle from "../../components/ui/Toggle.vue";

const enabled = ref(Boolean(studio.health.settings.enabled));
const demo = ref(Boolean(studio.health.settings.demo));
const enabledSessions = computed(
  () =>
    (studio.core.sessions || []).filter((s: any) => s.enabled && !s.archived)
      .length,
);

async function save() {
  try {
    await patchSettings({ enabled: enabled.value, demo: demo.value });
    studio.dirty = false;
    studio.health = await fetchState();
    toast("已保存并应用");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <div class="runtime-grid">
    <form
      id="runtime"
      class="card"
      @submit.prevent="save"
      @change="studio.dirty = true"
    >
      <div class="card-head">
        <div>
          <span class="eyebrow">运行开关</span>
          <h2>TA 现在可以说话吗</h2>
        </div>
      </div>
      <div class="switches">
        <Toggle v-model="enabled" name="enabled">
          <b>允许参与聊天</b>
          <small>总开关。关掉后 TA 不看也不回任何会话，心智照常保存。</small>
        </Toggle>
        <Toggle v-model="demo" name="demo">
          <b>仅模拟运行，不向 QQ 发送</b>
          <small
            >模拟模式下，「对话」里可以发模拟消息走完整流程；它们写进模拟会话，不进入真实记忆。</small
          >
        </Toggle>
      </div>
      <button class="primary" type="submit">保存运行状态</button>
    </form>
    <section class="card numbers">
      <button @click="go('chats')">
        <b>{{ enabledSessions }}</b
        ><span>参与中的会话</span>
      </button>
      <button @click="go('system', 'models')">
        <b>{{ studio.core.models.length }}</b
        ><span>可用模型</span>
      </button>
      <button @click="go('system', 'connect')">
        <b>{{ studio.health.connection?.online ? "在线" : "离线" }}</b
        ><span>QQ 连接</span>
      </button>
    </section>
  </div>
</template>

<style scoped>
.runtime-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 1fr);
  gap: var(--gap);
  align-items: start;
}
.switches {
  display: grid;
  gap: 16px;
  margin-bottom: 18px;
}
.switches :deep(.switch) {
  align-items: flex-start;
}
.switches :deep(.switch > span) {
  display: grid;
  gap: 2px;
}
.switches small {
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 400;
}
.numbers {
  display: grid;
  gap: 10px;
}
.numbers button {
  display: grid;
  justify-items: start;
  padding: 14px 16px;
  border-radius: 18px;
  text-align: left;
}
.numbers b {
  font: 700 24px var(--font-display);
  color: var(--accent);
}
.numbers span {
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 500;
}
@media (max-width: 900px) {
  .runtime-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
