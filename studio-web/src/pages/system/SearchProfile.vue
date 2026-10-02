<script setup lang="ts">
import { t } from "../../i18n";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api, toast } from "../../api";
import { studio } from "../../stores/studio";
import Select from "../../components/ui/Select.vue";
const fields = [
  "provider",
  "enabled",
  "baseUrl",
  "timeoutMs",
  "maxResults",
  "dailyLimit",
];
const draft = reactive<any>({
  provider: "tavily",
  enabled: true,
  baseUrl: "",
  apiKey: "",
  timeoutMs: 20000,
  maxResults: 5,
  dailyLimit: 12,
});
const active = ref<any>(null),
  busy = ref(false),
  loaded = ref(false),
  result = ref(""),
  failed = ref(false);
const drafts = new Map<string, any>();
let shownProvider = "tavily";
const changed = computed(
  () =>
    loaded.value &&
    (Boolean(draft.apiKey.trim()) ||
      fields.some((key) => draft[key] !== active.value?.[key])),
);
const providerName = (value: string) =>
  value === "brave" ? "Brave" : "Tavily";
const limitLabel = computed(() =>
  active.value?.dailyLimit === 0 ? t("不限") : (active.value?.dailyLimit ?? 12),
);
watch(changed, (value) => {
  studio.dirty = value;
});
watch(
  () => [studio.tick, studio.pulse],
  () => {
    if (
      loaded.value &&
      !busy.value &&
      studio.page === "system" &&
      studio.sub === "search"
    )
      void syncActive().catch(() => {});
  },
);
async function syncActive() {
  active.value = await api("/mind/time/search");
}
async function load() {
  try {
    await syncActive();
    Object.assign(draft, active.value, { apiKey: "" });
    shownProvider = draft.provider;
    loaded.value = true;
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function provider() {
  if (busy.value) return;
  busy.value = true;
  const selected = draft.provider;
  drafts.set(shownProvider, { ...draft, provider: shownProvider });
  try {
    Object.assign(
      draft,
      drafts.get(selected) || {
        ...(await api("/mind/time/search?provider=" + selected)),
        apiKey: "",
      },
    );
    shownProvider = selected;
    result.value = "";
  } catch (e) {
    draft.provider = shownProvider;
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
function input() {
  return Object.fromEntries(
    [...fields, "apiKey"].map((key) => [key, draft[key]]),
  );
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    const value = await api("/mind/time/search", "PATCH", input());
    active.value = value;
    Object.assign(draft, value, { apiKey: "" });
    drafts.set(draft.provider, { ...draft });
    shownProvider = draft.provider;
    toast(t("搜索配置已保存并生效"));
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function test() {
  if (busy.value) return;
  busy.value = true;
  result.value = "";
  failed.value = false;
  try {
    const r = await api("/mind/time/search/test", "POST", input());
    const vars = {
      source:
        r.profile.mode === "web"
          ? t("{provider} 联网检索", {
              provider: providerName(r.profile.provider),
            })
          : r.profile.materialLabel,
      count: r.results.length,
    };
    result.value = changed.value
      ? t(
          "{source}测试通过，返回 {count} 条资料。测试不占用每日查询额度；当前填写的配置尚未保存。",
          vars,
        )
      : t(
          "{source}测试通过，返回 {count} 条资料。测试不占用每日查询额度。",
          vars,
        );
  } catch (e) {
    failed.value = true;
    result.value = t("{error}。本次测试不占用每日查询额度。", {
      error: (e as Error).message,
    });
  } finally {
    try {
      await syncActive();
    } catch {
      /* Keep the last observed usage while offline. */
    }
    busy.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  studio.dirty = false;
});
</script>
<template>
  <section class="card search-profile">
    <span class="eyebrow">{{ t("SEARCH · 独立搜索") }}</span>
    <h2>{{ t("接触世界的资料") }}</h2>
    <p class="muted">
      {{
        t(
          "配置后优先联网检索。未配置密钥或关闭独立搜索时，使用当前模型整理已有知识。",
        )
      }}
    </p>
    <p v-if="loaded" class="faint">
      {{
        t("当前生效：{v}。表单修改保存后生效。", {
          v:
            active.mode === "web"
              ? t("{provider} · 联网检索资料", {
                  provider: providerName(active.provider),
                })
              : active.materialLabel,
        })
      }}
    </p>
    <form v-if="loaded" @submit.prevent="save">
      <label class="check"
        ><input v-model="draft.enabled" type="checkbox" :disabled="busy" />{{
          t("启用独立搜索")
        }}</label
      >
      <div class="search-fields">
        <label
          >{{ t("提供方")
          }}<Select
            v-model="draft.provider"
            :aria-label="t('搜索提供方')"
            :disabled="busy"
            :options="[
              { value: 'tavily', label: 'Tavily' },
              { value: 'brave', label: 'Brave' },
            ]"
            @change="provider"
        /></label>
        <label
          >{{ t("搜索地址")
          }}<input
            v-model="draft.baseUrl"
            type="url"
            required
            name="searchUrl"
            :disabled="busy"
        /></label>
        <label
          >{{ t("独立密钥")
          }}<input
            v-model="draft.apiKey"
            type="password"
            autocomplete="new-password"
            name="searchKey"
            :disabled="busy"
            :placeholder="
              draft.hasApiKey
                ? t('已保存，留空保留')
                : t('填写该提供方的搜索密钥')
            "
        /></label>
        <label
          >{{ t("超时（毫秒）")
          }}<input
            v-model.number="draft.timeoutMs"
            type="number"
            min="1000"
            max="120000"
            :disabled="busy"
        /></label>
        <label
          >{{ t("每次结果数")
          }}<input
            v-model.number="draft.maxResults"
            type="number"
            min="1"
            max="20"
            :disabled="busy"
        /></label>
        <label
          >{{ t("每日查询上限")
          }}<input
            v-model.number="draft.dailyLimit"
            name="searchDailyLimit"
            type="number"
            min="0"
            max="100000"
            :disabled="busy"
          />
          <small class="faint">{{
            t("可手动调整；0 表示不限。保存后立即生效。")
          }}</small></label
        >
      </div>
      <div class="search-usage" role="status">
        <span class="chip">{{
          t("今日有效查询 {v} / {limitLabel}", {
            v: active.used || 0,
            limitLabel,
          })
        }}</span>
        <small class="faint">{{
          t("{v} 次进行中 · {v2} 次失败 · {v3} 次测试", {
            v: active.usage?.running || 0,
            v2: active.usage?.failed || 0,
            v3: active.usage?.diagnostics || 0,
          })
        }}</small>
      </div>
      <p class="faint">
        {{
          t(
            "测试当前填写的配置，不会自动保存。失败与连接测试不占本地每日额度；提供方的账户额度由提供方管理。",
          )
        }}
      </p>
      <div class="row">
        <button class="primary" :disabled="busy">{{ t("保存搜索") }}</button>
        <button type="button" :disabled="busy" @click="test">
          {{ busy ? t("处理中…") : t("测试连接") }}
        </button>
        <span v-if="changed" class="faint">{{ t("有尚未保存的修改") }}</span>
      </div>
      <p
        v-if="result"
        :role="failed ? 'alert' : 'status'"
        class="search-result"
        :class="{ failed }"
      >
        {{ result }}
      </p>
    </form>
  </section>
</template>
<style scoped>
.search-profile {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.search-profile form {
  display: grid;
  gap: 18px;
}
.search-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.search-fields label {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.search-fields input,
.search-fields .menu-select {
  width: 100%;
  min-width: 0;
}
.search-usage {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.search-result {
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  overflow-wrap: anywhere;
}
.search-result.failed {
  border-color: color-mix(in srgb, var(--warn) 40%, var(--line));
}
@media (max-width: 620px) {
  .search-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
