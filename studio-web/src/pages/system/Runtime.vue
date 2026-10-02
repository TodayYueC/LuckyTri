<script setup lang="ts">
import { t } from "../../i18n";
import { computed, ref } from "vue";
import { toast } from "../../api";
import { go, studio } from "../../stores/studio";
import { fetchState, patchSettings } from "../../plates/workspace";
import Toggle from "../../components/ui/Toggle.vue";
import { ago } from "../../format";

const enabled = ref(Boolean(studio.health.settings.enabled));
const demo = ref(Boolean(studio.health.settings.demo));
const enabledSessions = computed(
  () =>
    (studio.core.sessions || []).filter((s: any) => s.enabled && !s.archived)
      .length,
);

// Her whole continuity is one database file, so whether a copy of it is
// being kept belongs next to the switches that decide whether she runs.
const backup = computed(() => {
  const state = studio.health.backup;
  if (!state) return null;
  if (!state.enabled)
    return {
      value: t("已关闭"),
      caption: t("自动备份"),
      tone: "warn",
      title: "",
    };
  if (state.lastError)
    return {
      value: t("失败"),
      caption: t("自动备份出错，稍后重试"),
      tone: "danger",
      title: state.lastError.message,
    };
  if (!state.latest)
    return {
      value: t("还没有"),
      caption: t("自动备份，运行一阵后会做第一份"),
      tone: "",
      title: "",
    };
  const mb = Math.max(1, Math.round(state.latest.bytes / 1048576));
  return {
    value: ago(state.latest.at),
    caption: t("上次自动备份 · {mb} MB · 已留 {count}/{keep} 份", {
      mb,
      count: state.count,
      keep: state.keep,
    }),
    tone: "",
    title: state.latest.name,
  };
});

async function save() {
  try {
    await patchSettings({ enabled: enabled.value, demo: demo.value });
    studio.dirty = false;
    studio.health = await fetchState();
    toast(t("已保存并应用"));
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
          <span class="eyebrow">{{ t("运行开关") }}</span>
          <h2>{{ t("TA 现在可以说话吗") }}</h2>
        </div>
      </div>
      <div class="switches">
        <Toggle v-model="enabled" name="enabled">
          <b>{{ t("允许参与聊天") }}</b>
          <small>{{
            t("总开关。关掉后 TA 不看也不回任何会话，心智照常保存。")
          }}</small>
        </Toggle>
        <Toggle v-model="demo" name="demo">
          <b>{{ t("仅模拟运行，不向 QQ 发送") }}</b>
          <small>{{
            t(
              "模拟模式下，「对话」里可以发模拟消息走完整流程；它们写进模拟会话，不进入真实记忆。",
            )
          }}</small>
        </Toggle>
      </div>
      <div class="save-bar">
        <button class="primary" type="submit">{{ t("保存运行状态") }}</button>
        <small class="faint">{{
          studio.dirty ? t("有未保存的修改") : t("已保存，立刻生效")
        }}</small>
      </div>
    </form>
    <section class="card numbers">
      <button @click="go('chats')">
        <b>{{ enabledSessions }}</b
        ><span>{{ t("参与中的会话") }}</span>
      </button>
      <button @click="go('system', 'models')">
        <b>{{ studio.core.models.length }}</b
        ><span>{{ t("可用模型") }}</span>
      </button>
      <button @click="go('system', 'connect')">
        <b>{{ studio.health.connection?.online ? t("在线") : t("离线") }}</b
        ><span>{{ t("QQ 连接") }}</span>
      </button>
      <div
        v-if="backup"
        class="stat"
        :class="backup.tone"
        :title="backup.title"
        data-testid="backup-status"
      >
        <b>{{ backup.value }}</b
        ><span>{{ backup.caption }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.runtime-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.8fr);
  gap: var(--gap);
  align-items: start;
}
.runtime-grid > .card {
  background:
    radial-gradient(
      ellipse at 90% 0,
      color-mix(in srgb, var(--glow-a) 20%, transparent),
      transparent 55%
    ),
    var(--surface);
}
.runtime-grid .card-head h2 {
  margin-top: 5px;
  font-size: 23px;
  letter-spacing: -0.035em;
}
.switches {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}
.switches :deep(.switch) {
  align-items: flex-start;
  padding: 18px;
  border: 1px solid rgb(255 255 255 / 0.78);
  border-radius: 22px;
  background: rgb(255 255 255 / 0.41);
  box-shadow:
    inset 0 1px 0 white,
    0 10px 22px -23px var(--accent);
  backdrop-filter: blur(18px) saturate(1.5);
  transition:
    transform 0.35s var(--spring),
    background-color 0.2s;
}
.switches :deep(.switch:hover) {
  transform: translateY(-3px) scale(1.008);
  background: rgb(255 255 255 / 0.64);
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
  gap: 12px;
}
.numbers button,
.numbers .stat {
  display: grid;
  justify-items: start;
  gap: 2px;
  padding: 20px 21px;
  border: 1px solid rgb(255 255 255 / 0.83);
  border-radius: 22px;
  background:
    radial-gradient(
      ellipse at 100% 0,
      color-mix(in srgb, var(--glow-b) 24%, transparent),
      transparent 63%
    ),
    rgb(255 255 255 / 0.44);
  box-shadow:
    inset 0 1px 0 white,
    0 12px 26px -24px var(--accent);
  text-align: left;
  backdrop-filter: blur(18px) saturate(1.55);
  transition:
    transform 0.38s var(--spring),
    box-shadow 0.23s;
}
.numbers button:hover:not(:disabled) {
  transform: translateX(5px) scale(1.018);
  box-shadow:
    inset 0 1px 0 white,
    0 18px 28px -22px var(--accent);
}
.numbers b {
  font: 750 29px var(--font-display);
  color: var(--accent);
}
.numbers .stat.warn b {
  color: var(--warn);
}
.numbers .stat.danger b {
  color: var(--danger);
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
