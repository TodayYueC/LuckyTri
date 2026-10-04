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
const marketUnavailable = ref(false);
const marketLoading = ref(false);
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
function loadMarket() {
  marketLoading.value = true;
  api<any>("/plugins/market")
    .then((data) => {
      market.value = data.plugins || [];
      marketUnavailable.value = Boolean(data.unavailable);
    })
    .catch(() => {
      market.value = [];
      marketUnavailable.value = true;
    })
    .finally(() => {
      marketLoading.value = false;
    });
}
watch(view, (next) => {
  setSub(next);
  if (next === "market") loadMarket();
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
  for (const field of data.fields || []) {
    const value = data.values?.[field.key] ?? field.default;
    if (field.type === "boolean") next[field.key] = value === true;
    else if (field.type === "urls")
      next[field.key] = Array.isArray(value) ? value.join("\n") : (value ?? "");
    else next[field.key] = value ?? "";
  }
  settings.value = next;
});
async function saveSettings() {
  if (!selected.value) return;
  error.value = "";
  await api(`/plugins/${selected.value.id}/settings`, {
    method: "PUT",
    body: JSON.stringify({ values: settings.value }),
  });
}

async function agree(plugin: any) {
  error.value = "";
  try {
    if (openId.value === plugin.id)
      await api(`/plugins/${plugin.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ values: settings.value }),
      });
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
  if (view.value === "market") loadMarket();
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
function stateLabel(plugin: any) {
  if (plugin.running) return t("运行中");
  if (plugin.state === "error") return t("出错");
  if (plugin.enabled) return t("正在启动");
  if (plugin.source === "builtin") return t("内置，未启用");
  return t("已安装，未启用");
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
        { key: 'installed', label: t('插件列表') },
        { key: 'market', label: t('插件市场') },
        { key: 'actions', label: t('她想做的事'), count: actions.length },
        { key: 'import', label: t('导入与开发') },
      ]"
    />
    <section v-if="view === 'installed'" class="stack">
      <p class="lead">
        {{ t("天气随 LuckyTri 附带，默认关闭。启用前会先列出它要的权限。") }}
      </p>
      <div class="grid">
        <Empty
          v-if="!plugins.length"
          :title="t('还没有接上插件')"
          :text="t('内置的天气可以在这里启用，也可以从市场安装。')"
        />
        <Card
          v-for="plugin in plugins"
          :key="plugin.id"
          :title="plugin.manifest.name || plugin.id"
        >
          <p>{{ plugin.manifest.description }}</p>
          <p class="muted">
            {{ plugin.version }} · {{ stateLabel(plugin) }}
            <span v-if="plugin.status?.text"> · {{ plugin.status.text }}</span>
          </p>
          <div class="row">
            <button
              v-if="!plugin.enabled"
              class="primary"
              @click="openId = plugin.id"
            >
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
      </div>
    </section>
    <section v-else-if="view === 'market'" class="grid">
      <Empty
        v-if="marketLoading"
        :title="t('正在查看市场')"
        :text="t('连不上的话，这里会说明，不会再显示一串英文错误。')"
      />
      <Empty
        v-else-if="!market.length"
        :title="t('市场暂时没有条目')"
        :text="
          marketUnavailable
            ? t(
                '插件市场的索引还没有发布，或现在连不上。随程序附带的插件在「插件列表」里，默认关闭。',
              )
            : t('索引仓库还是空的，或者现在连不上。你仍然可以导入一个插件包。')
        "
      />
      <template v-if="!marketLoading">
        <Card
          v-for="item in market"
          :key="item.id || item.source"
          :title="item.name || item.id"
        >
          <p>{{ item.description }}</p>
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
      </template>
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
          class="settings"
          @submit.prevent="
            saveSettings().catch((e) => (error.value = e.message))
          "
        >
          <template
            v-for="field in selected.manifest.settings || []"
            :key="field.key"
          >
            <label v-if="field.type === 'boolean'" class="switch">
              <span>{{ field.label }}</span>
              <input v-model="settings[field.key]" type="checkbox" />
            </label>
            <Field v-else :label="field.label">
              <input
                v-if="field.type === 'secret'"
                type="password"
                v-model="settings[field.key]"
                :placeholder="t('已保存的不会回显')"
              />
              <textarea
                v-else-if="field.type === 'textarea' || field.type === 'urls'"
                v-model="settings[field.key]"
                rows="4"
                :placeholder="
                  field.type === 'urls' ? t('一行一个地址') : undefined
                "
              />
              <input v-else v-model="settings[field.key]" />
            </Field>
          </template>
          <div class="row">
            <button class="ghost" type="submit">{{ t("保存设置") }}</button>
            <button
              v-if="!selected.enabled"
              class="primary"
              type="button"
              @click="agree(selected)"
            >
              {{ t("同意这些权限并启用") }}
            </button>
          </div>
        </form>
        <iframe
          v-if="selected.enabled && selected.manifest.contributes?.page"
          ref="frame"
          class="plugin-frame"
          sandbox="allow-scripts allow-forms"
          :src="`/plugin-ui/${selected.id}/index.html`"
        />
        <div v-if="selected.source !== 'builtin'" class="row">
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
.plugins-intro {
  position: relative;
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
.plugins-intro::before {
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
}
.plugins-intro h1,
.plugins-intro p,
.plugins-intro .eyebrow {
  position: relative;
}
.plugins-intro h1 {
  margin: 10px 0 7px;
  font-size: clamp(28px, 3.25vw, 42px);
  letter-spacing: -0.055em;
}
.plugins-intro h1 em {
  font-style: normal;
  color: var(--accent);
}
.plugins-intro p {
  max-width: 560px;
  color: var(--ink-soft);
  font-size: 13.5px;
}
.stack {
  display: grid;
  gap: 14px;
}
.lead {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13.5px;
}
@media (max-width: 760px) {
  .plugins-intro {
    min-height: 0;
    padding: 27px 23px;
  }
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
.settings {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}
.settings .switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgb(255 255 255 / 0.78);
  border-radius: 18px;
  background: rgb(255 255 255 / 0.42);
  box-shadow: inset 0 1px 0 white;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ink);
}
.settings .switch input {
  padding: 0;
  border: none;
  box-shadow: none;
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
