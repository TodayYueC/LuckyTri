<script setup lang="ts">
import { ref, onMounted } from "vue";
import { t, N_, localized } from "../../i18n";
import { api, toast } from "../../api";
import { when } from "../../plates/mind";

const state = ref<any>(null);
const busy = ref(false);
const labels: Record<string, string> = localized({
  unchecked: N_("尚未检查更新"),
  available: N_("有新版本可用"),
  current: N_("已是最新发布版本"),
  ahead: N_("当前版本领先于 npm 发布版本"),
  unavailable: N_("暂时无法检查更新"),
});
onMounted(async () => {
  try {
    state.value = await api("/system/update");
  } catch (error) {
    toast((error as Error).message, true);
  }
});
async function check() {
  if (busy.value) return;
  busy.value = true;
  try {
    state.value = await api("/system/update/check", "POST", {});
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card update-settings" aria-labelledby="update-title">
    <header>
      <div>
        <span class="eyebrow">LUCKYTRI / VERSION</span>
        <h2 id="update-title">{{ t("版本与更新") }}</h2>
      </div>
      <button :disabled="busy || !state" @click="check">
        {{ busy ? t("正在检查…") : t("检查更新") }}
      </button>
    </header>
    <template v-if="state">
      <p
        class="version-state"
        :class="{ available: state.status === 'available' }"
        role="status"
      >
        {{ labels[state.status] || labels.unchecked }}
      </p>
      <dl class="kv">
        <dt>{{ t("当前版本") }}</dt>
        <dd>{{ state.current }}</dd>
        <dt>{{ t("npm 最新版本") }}</dt>
        <dd>{{ state.latest || "—" }}</dd>
        <dt>{{ t("上次成功检查") }}</dt>
        <dd>{{ state.checkedAt ? when(state.checkedAt) : "—" }}</dd>
      </dl>
      <p v-if="state.error" class="muted" role="alert">
        {{ t("暂时无法连接 npm 或读取版本信息，请稍后重试。") }}
      </p>
      <p class="muted small-text">
        {{ t("点击时才检查，五分钟内复用结果。检查更新不会自动安装或重启。") }}
      </p>
      <div v-if="state.status === 'available'" class="update-how">
        <p v-if="state.installation === 'source'">
          {{
            t("源码安装：更新 main、安装依赖并构建后重启，保留现有数据与配置。")
          }}
        </p>
        <template v-else
          ><p>{{ t("停止实例后执行升级命令，再启动 LuckyTri。") }}</p>
          <code>npm install -g luckytri@latest</code></template
        >
      </div>
      <nav class="update-links">
        <a :href="state.npmUrl" target="_blank" rel="noopener noreferrer">npm</a
        ><a :href="state.releaseUrl" target="_blank" rel="noopener noreferrer"
          >{{ t("发布说明") }} ↗</a
        >
      </nav>
    </template>
  </section>
</template>

<style scoped>
.update-settings {
  display: grid;
  gap: 14px;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
h2 {
  margin-top: 5px;
}
.version-state {
  font-weight: 700;
}
.version-state.available {
  color: var(--accent);
}
.small-text {
  font-size: 12px;
}
.update-how {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
}
code {
  display: block;
  margin-top: 9px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.update-links {
  display: flex;
  gap: 18px;
  font-size: 13px;
}
</style>
