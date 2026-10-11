<script setup lang="ts">
import { t } from "../../i18n";
import { computed, onMounted, ref } from "vue";
import { api } from "../../api";
import { studio } from "../../stores/studio";

const status = ref<any>(null);
const error = ref("");
const sessions = computed(() => studio.core?.sessions || []);
const session = ref("");
const text = ref("");
const probe = ref<any>(null);
const busy = ref(false);

const KIND: Record<string, string> = {
  fact: t("事实"),
  episode: t("情景"),
  meeting: t("相遇"),
  self: t("自我线索"),
  thought: t("念头"),
  diary: t("日记"),
  period: t("回顾"),
  anticipation: t("约定"),
  message: t("原话"),
};
const WHY: Record<string, string> = {
  meaning: t("意思相关"),
  words: t("说到了"),
  person: t("关于这个人"),
};

const coverage = computed(() => {
  const c = status.value?.coverage;
  if (!c?.total) return "";
  return `${c.embedded || 0} / ${c.total}`;
});

async function load() {
  try {
    status.value = await api("/mind/recall");
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function run() {
  if (!session.value || !text.value.trim()) return;
  busy.value = true;
  try {
    probe.value = await api("/mind/recall/probe", "POST", {
      session: session.value,
      text: text.value,
    });
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="card recall-panel" aria-labelledby="recall-title">
    <h2 id="recall-title">{{ t("回忆索引") }}</h2>
    <p class="muted">
      {{
        t(
          "她的事实、情景、自我线索和近一个月的原话都在同一个索引里，按意思、字词和相关的人一起检索。向量还没覆盖的部分先按字词找。",
        )
      }}
    </p>
    <div v-if="status" class="stats">
      <span v-for="item in status.items" :key="item.kind" class="pill"
        >{{ KIND[item.kind] || item.kind }} {{ item.n }}</span
      >
      <span v-if="coverage" class="pill strong"
        >{{ t("已有向量") }} {{ coverage }}</span
      >
      <span v-if="status.embedding?.latencyMs" class="pill"
        >{{ t("向量延迟") }} {{ status.embedding.latencyMs.p50 }} ms</span
      >
      <span v-if="status.embedding?.lastError" class="pill warn">{{
        status.embedding.lastError
      }}</span>
    </div>
    <ul v-if="status?.waiting?.length" class="waiting">
      <li v-for="row in status.waiting" :key="row.key">
        {{ t("等待重试") }} {{ row.key }} × {{ row.failures }}：{{
          row.lastError
        }}
      </li>
    </ul>
    <ul v-if="status?.unavailableModels?.length" class="waiting">
      <li v-for="row in status.unavailableModels" :key="row.key">
        {{ t("暂时停用的备用模型") }} {{ row.label }}：{{ row.reason }}
      </li>
    </ul>
    <form class="probe" @submit.prevent="run">
      <select v-model="session" name="recallSession" required>
        <option value="" disabled>{{ t("选择会话") }}</option>
        <option v-for="s in sessions" :key="s.id" :value="s.id">
          {{ s.name || s.id }}
        </option>
      </select>
      <input
        v-model="text"
        name="recallText"
        maxlength="500"
        :placeholder="t('输入一句话，看她会想起什么')"
      />
      <button :disabled="busy || !session || !text.trim()">
        {{ t("试试回忆") }}
      </button>
    </form>
    <p v-if="error" role="status">{{ error }}</p>
    <div v-if="probe" class="result">
      <p class="faint">
        {{ probe.mode === "hybrid" ? t("意思与字词一起") : t("仅字词") }} ·
        {{ t("候选") }} {{ probe.candidates }}
      </p>
      <ol>
        <li v-for="item in probe.items" :key="item.id">
          <strong>{{ KIND[item.kind] || item.kind }}</strong>
          {{ item.text }}
          <small class="faint">
            {{ WHY[item.why] }}
            <template v-if="item.standsOut !== null">
              · {{ t("突出度") }} {{ item.standsOut }}</template
            >
            · {{ t("共有字词") }} {{ item.sharedWords }}
          </small>
        </li>
      </ol>
      <p v-if="!probe.items.length" class="faint">{{ t("没有想起什么") }}</p>
    </div>
  </section>
</template>

<style scoped>
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.pill {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface-2, rgba(127, 127, 127, 0.12));
  font-size: 0.85em;
}
.pill.strong {
  font-weight: 600;
}
.pill.warn {
  color: var(--danger, #c0392b);
}
.waiting {
  margin: 8px 0;
  padding-left: 18px;
  font-size: 0.85em;
}
.probe {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(200px, 3fr) auto;
  gap: 8px;
  margin-top: 12px;
}
.result ol {
  padding-left: 20px;
}
.result li {
  margin: 6px 0;
}
</style>
