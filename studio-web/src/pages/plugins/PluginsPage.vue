<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { api } from "../../api";
import { t } from "../../i18n";
import { setSub, studio } from "../../stores/studio";
import Card from "../../components/ui/Card.vue";
import Empty from "../../components/ui/Empty.vue";
import Field from "../../components/ui/Field.vue";
import Sheet from "../../components/ui/Sheet.vue";
import Tabs from "../../components/ui/Tabs.vue";

const VIEWS = ["installed", "market", "actions", "import"];
const view = ref(VIEWS.includes(studio.sub) ? studio.sub : "installed");
const plugins = ref<any[]>([]);
const market = ref<any[]>([]);
const actions = ref<any[]>([]);
const error = ref("");
const openId = ref("");
const staged = ref<any>(null);
const settings = ref<Record<string, unknown>>({});
const urlForm = ref({ url: "", sha256: "" });
const github = ref("");
const dir = ref("");
const registry = ref("");
const frame = ref<HTMLIFrameElement | null>(null);
const selected = computed(() =>
  plugins.value.find((item) => item.id === openId.value),
);

async function load() {
  plugins.value = (await api<any>("/plugins")).plugins || [];
  try {
    actions.value = (await api<any>("/plugins/actions/pending")).actions || [];
  } catch {
    actions.value = [];
  }
}
watch(view, (next) => {
  setSub(next);
  if (next === "market")
    api<any>("/plugins/market")
      .then((data) => (market.value = data.plugins || []))
      .catch((e) => (error.value = e.message));
});
watch(
  () => studio.sub,
  (sub) => {
    if (VIEWS.includes(sub)) view.value = sub;
  },
);
watch(openId, async (id) => {
  if (!id) return;
  const data = await api<any>(`/plugins/${id}/settings`);
  const next: Record<string, unknown> = {};
  for (const field of data.fields || [])
    next[field.key] = data.values?.[field.key] ?? field.default;
  settings.value = next;
});

async function agree(plugin: any) {
  error.value = "";
  try {
    await api(`/plugins/${plugin.id}/grant`, {
      method: "POST",
      body: JSON.stringify({ permissions: plugin.permissions }),
    });
    await api(`/plugins/${plugin.id}/enable`, { method: "POST", body: "{}" });
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function stage(path: string, body: unknown) {
  error.value = "";
  try {
    staged.value = await api(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    error.value = e.message;
  }
}
async function commit() {
  if (!staged.value) return;
  await api("/plugins/import/commit", {
    method: "POST",
    body: JSON.stringify({ token: staged.value.token }),
  });
  const plugin = staged.value;
  staged.value = null;
  await api(`/plugins/${plugin.manifest.id}/grant`, {
    method: "POST",
    body: JSON.stringify({ permissions: plugin.permissions }),
  });
  view.value = "installed";
  await load();
}
function onFrameMessage(event: MessageEvent) {
  const data = event.data || {};
  if (
    data.luckytri !== 1 ||
    !selected.value ||
    event.source !== frame.value?.contentWindow
  )
    return;
  const path = String(data.path || "/");
  if (!path.startsWith("/")) return;
  api(`/plugins/${selected.value.id}/x${path}`, {
    method: data.method || "GET",
    body: data.body ? JSON.stringify(data.body) : undefined,
  })
    .then((result) =>
      frame.value?.contentWindow?.postMessage(
        { id: data.id, ok: true, result },
        location.origin,
      ),
    )
    .catch((reason) =>
      frame.value?.contentWindow?.postMessage(
        { id: data.id, ok: false, error: reason.message },
        location.origin,
      ),
    );
}
onMounted(() => {
  load().catch((e) => (error.value = e.message));
  window.addEventListener("message", onFrameMessage);
});
onUnmounted(() => window.removeEventListener("message", onFrameMessage));
function riskLabel(risk: string) {
  return risk === "high"
    ? t("高风险")
    : risk === "medium"
      ? t("中风险")
      : t("低风险");
}
</script>

<template>
  <div class="page plugins">
    <header class="plugins-intro">
      <span class="eyebrow">{{ t("THE WORLD SHE CAN TOUCH · 插件") }}</span>
      <h1>
        {{ t("核心是她。") }}<em>{{ t("插件是世界。") }}</em>
      </h1>
      <p>
        {{
          t("插件只能经她同意接触世界。它们读不到她的数据库，也不能替她开口。")
        }}
      </p>
    </header>
    <p v-if="error" class="warn-text" role="alert">{{ error }}</p>
    <Tabs
      :model-value="view"
      @update:model-value="view = $event"
      :label="t('插件的分区')"
      :items="[
        { key: 'installed', label: t('已接上') },
        { key: 'market', label: t('插件市场') },
        { key: 'actions', label: t('她想做的事'), count: actions.length },
        { key: 'import', label: t('导入与开发') },
      ]"
    />
    <section v-if="view === 'installed'" class="grid">
      <Empty
        v-if="!plugins.length"
        :title="t('还没有接上插件')"
        :text="
          t('内置的天气、订阅和网页聊天可以在这里启用，也可以从市场安装。')
        "
      />
      <Card
        v-for="plugin in plugins"
        :key="plugin.id"
        :title="plugin.manifest.name || plugin.id"
      >
        <p>{{ plugin.manifest.description }}</p>
        <p class="muted">
          {{ plugin.version }} ·
          {{ plugin.running ? t("运行中") : plugin.state }}
          <span v-if="plugin.status?.text"> · {{ plugin.status.text }}</span>
        </p>
        <div class="row">
          <button v-if="!plugin.enabled" class="primary" @click="agree(plugin)">
            {{ t("查看权限并启用") }}
          </button>
          <button
            v-else
            class="ghost"
            @click="
              api(`/plugins/${plugin.id}/disable`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            "
          >
            {{ t("停用") }}
          </button>
          <button class="ghost" @click="openId = plugin.id">
            {{ t("详情") }}
          </button>
        </div>
      </Card>
    </section>
    <section v-else-if="view === 'market'" class="grid">
      <Empty
        v-if="!market.length"
        :title="t('市场暂时没有条目')"
        :text="
          t('索引仓库还是空的，或者现在连不上。你仍然可以导入一个插件包。')
        "
      />
      <Card
        v-for="item in market"
        :key="item.id || item.source"
        :title="item.name || item.source"
      >
        <p v-if="item.error" class="warn-text">{{ item.error }}</p>
        <p v-else>{{ item.description }}</p>
        <button
          v-if="item.latest"
          class="primary"
          @click="
            stage('/plugins/market/stage', {
              url: item.latest.url,
              sha256: item.latest.sha256,
              id: item.id,
            })
          "
        >
          {{ t("安装") }} {{ item.latest.version }}
        </button>
      </Card>
    </section>
    <section v-else-if="view === 'actions'" class="grid">
      <Empty
        v-if="!actions.length"
        :title="t('没有等待同意的事')"
        :text="t('高风险的行动会先停在这里，等你点头。过一天就不再算数。')"
      />
      <Card v-for="action in actions" :key="action.id" :title="action.label">
        <p>{{ action.reason }}</p>
        <div class="row">
          <button
            class="primary"
            @click="
              api(`/plugins/actions/${action.id}/approve`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            "
          >
            {{ t("同意") }}
          </button>
          <button
            class="ghost"
            @click="
              api(`/plugins/actions/${action.id}/reject`, {
                method: 'POST',
                body: '{}',
              }).then(load)
            "
          >
            {{ t("拒绝") }}
          </button>
        </div>
      </Card>
    </section>
    <section v-else class="grid">
      <Card :title="t('从链接导入')">
        <Field :label="t('插件包地址')"><input v-model="urlForm.url" /></Field>
        <Field :label="t('校验值，可留空')"
          ><input v-model="urlForm.sha256"
        /></Field>
        <button class="primary" @click="stage('/plugins/import/url', urlForm)">
          {{ t("检查这个包") }}
        </button>
      </Card>
      <Card :title="t('从 GitHub 导入')">
        <Field :label="t('仓库地址')"
          ><input v-model="github" placeholder="https://github.com/owner/name"
        /></Field>
        <button
          class="primary"
          @click="stage('/plugins/import/github', { repository: github })"
        >
          {{ t("检查这个仓库") }}
        </button>
      </Card>
      <Card :title="t('本机目录（开发）')">
        <Field :label="t('目录')"><input v-model="dir" /></Field>
        <button class="ghost" @click="stage('/plugins/import/dir', { dir })">
          {{ t("按开发插件接上") }}
        </button>
      </Card>
      <Card :title="t('索引源')">
        <Field :label="t('索引地址')"><input v-model="registry" /></Field>
        <button
          class="ghost"
          @click="
            api('/plugins/sources', {
              method: 'POST',
              body: JSON.stringify({ url: registry }),
            })
          "
        >
          {{ t("添加索引") }}
        </button>
      </Card>
    </section>
    <Card v-if="staged" :title="t('先看清它要什么')">
      <p>
        {{ staged.manifest?.name }} {{ staged.manifest?.version }} ·
        {{ staged.trusted ? t("校验通过") : t("未登记来源") }}
      </p>
      <ul>
        <li v-for="name in staged.permissions" :key="name">{{ name }}</li>
      </ul>
      <button class="primary" @click="commit">
        {{ t("同意这些权限并安装") }}
      </button>
    </Card>
    <Sheet
      :open="!!selected"
      :title="selected?.manifest.name || ''"
      @close="openId = ''"
    >
      <template v-if="selected">
        <p>{{ selected.manifest.description }}</p>
        <ul>
          <li v-for="item in selected.risk" :key="item.name">
            {{ riskLabel(item.risk) }} · {{ item.label }}
          </li>
        </ul>
        <form
          @submit.prevent="
            api(`/plugins/${selected.id}/settings`, {
              method: 'PUT',
              body: JSON.stringify({ values: settings }),
            })
          "
        >
          <Field
            v-for="field in selected.manifest.settings || []"
            :key="field.key"
            :label="field.label"
          >
            <input
              v-if="field.type === 'secret'"
              type="password"
              v-model="settings[field.key]"
              :placeholder="t('已保存的不会回显')"
            />
            <input
              v-else-if="field.type === 'boolean'"
              type="checkbox"
              v-model="settings[field.key]"
            />
            <textarea
              v-else-if="field.type === 'textarea' || field.type === 'urls'"
              v-model="settings[field.key]"
            />
            <input v-else v-model="settings[field.key]" />
          </Field>
          <button class="primary" type="submit">{{ t("保存设置") }}</button>
        </form>
        <iframe
          v-if="selected.enabled && selected.manifest.contributes?.page"
          ref="frame"
          class="plugin-frame"
          sandbox="allow-scripts allow-forms"
          :src="`/plugin-ui/${selected.id}/index.html`"
        />
        <div class="row">
          <button
            class="ghost"
            @click="
              api(`/plugins/${selected.id}`, {
                method: 'DELETE',
                body: '{}',
              }).then(() => {
                openId = '';
                load();
              })
            "
          >
            {{ t("卸载") }}
          </button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.plugins {
  display: grid;
  gap: var(--gap);
}
.plugins-intro h1 {
  margin: 8px 0;
  font-size: clamp(28px, 3vw, 40px);
}
.plugins-intro h1 em {
  font-style: normal;
  color: var(--accent);
}
.grid {
  display: grid;
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.muted {
  color: var(--ink-soft);
  font-size: 13px;
}
.warn-text {
  color: var(--warn);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.plugin-frame {
  width: 100%;
  min-height: 280px;
  border: 0;
  border-radius: 16px;
}
</style>
