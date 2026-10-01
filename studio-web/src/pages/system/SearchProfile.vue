<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api, toast } from "../../api";
const draft = reactive<any>({
    provider: "tavily",
    enabled: true,
    baseUrl: "",
    apiKey: "",
    timeoutMs: 20000,
    maxResults: 5,
    dailyLimit: 12,
  }),
  busy = ref(false),
  loaded = ref(false),
  result = ref("");
async function load() {
  try {
    Object.assign(draft, await api("/mind/time/search"), { apiKey: "" });
    loaded.value = true;
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function provider() {
  busy.value = true;
  try {
    Object.assign(
      draft,
      await api("/mind/time/search?provider=" + draft.provider),
      { apiKey: "" },
    );
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function save() {
  busy.value = true;
  try {
    Object.assign(draft, await api("/mind/time/search", "PATCH", draft), {
      apiKey: "",
    });
    toast("独立搜索已保存");
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function test() {
  busy.value = true;
  try {
    const r = await api("/mind/time/search/test", "POST", {});
    result.value = `${r.profile.materialLabel}，返回 ${r.results.length} 条资料；今日查询 ${r.profile.used}/${r.profile.dailyLimit}`;
  } catch (e) {
    result.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="card search-profile">
    <span class="eyebrow">SEARCH · 独立搜索</span>
    <h2>接触世界的资料</h2>
    <p class="muted">
      配置后优先联网检索。未配置密钥或关闭独立搜索时，直接使用当前模型整理已有知识，继续推进资料体验。
    </p>
    <p v-if="loaded" class="faint">
      当前使用：{{ draft.materialLabel }}。模型资料保留来源与不确定之处。
    </p>
    <form v-if="loaded" @submit.prevent="save">
      <label class="check"
        ><input v-model="draft.enabled" type="checkbox" />启用独立搜索</label
      >
      <div class="search-fields">
        <label
          >提供方<select v-model="draft.provider" @change="provider">
            <option value="tavily">Tavily</option>
            <option value="brave">Brave</option>
          </select></label
        ><label
          >搜索地址<input
            v-model="draft.baseUrl"
            type="url"
            required
            name="searchUrl" /></label
        ><label
          >独立密钥<input
            v-model="draft.apiKey"
            type="password"
            autocomplete="new-password"
            :placeholder="
              draft.hasApiKey ? '已保存，留空保留' : '填写该提供方的搜索密钥'
            "
            name="searchKey" /></label
        ><label
          >超时（毫秒）<input
            v-model.number="draft.timeoutMs"
            type="number"
            min="1000"
            max="120000" /></label
        ><label
          >每次结果数<input
            v-model.number="draft.maxResults"
            type="number"
            min="1"
            max="20" /></label
        ><label
          >每日查询上限<input
            v-model.number="draft.dailyLimit"
            type="number"
            min="1"
            max="1000"
        /></label>
      </div>
      <div class="row">
        <button class="primary" :disabled="busy">保存搜索</button
        ><button type="button" :disabled="busy" @click="test">测试连接</button
        ><span class="faint"
          >今日 {{ draft.used || 0 }} / {{ draft.dailyLimit }} 次</span
        >
      </div>
      <p v-if="result" role="status">{{ result }}</p>
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
.search-fields select {
  width: 100%;
  min-width: 0;
}
@media (max-width: 620px) {
  .search-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
