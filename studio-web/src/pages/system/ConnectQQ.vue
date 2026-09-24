<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toast } from "../../api";
import { go, studio } from "../../stores/studio";
import type { Page } from "../../router";
import {
  checkNapCatUpdate,
  configureQq,
  installNapCat,
  launchNapCat,
  pickNapCatFolder,
  prepareQqToken,
  qqSetup,
} from "../../plates/connect";

const emit = defineEmits<{ open: [sub: string] }>();
const setup = ref<any>(null);
const busy = ref(false);
const root = ref("");
const updateText = ref("");
const account = ref("");
const online = computed(() => Boolean(studio.health.connection?.online));
const FIX: Record<string, [Page | "", string]> = {
  token: ["", "connect"],
  qq: ["", "connect"],
  model: ["", "models"],
  mode: ["", "runtime"],
  session: ["chats", ""],
  persona: ["nature", ""],
};

async function run(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function load() {
  setup.value = await qqSetup();
  root.value = setup.value.root || "";
}

async function install(latest = false) {
  const result = await installNapCat(latest);
  root.value = result.root;
  await load();
  toast("安装器已处理");
}

async function checkUpdate() {
  const update = await checkNapCatUpdate();
  updateText.value = update.message || JSON.stringify(update);
}

async function pick() {
  const result = await pickNapCatFolder();
  root.value = result.root;
}

async function configure() {
  await prepareQqToken();
  await configureQq({ root: root.value, accountId: account.value });
  await load();
  toast("已写入 OneBot 反向连接");
}

async function launch() {
  await launchNapCat(root.value);
  toast("已尝试启动 NapCat");
}

function fix(id: string) {
  const [page, sub] = FIX[id] || ["", "connect"];
  if (page) go(page);
  else emit("open", sub);
}

onMounted(load);
</script>

<template>
  <div class="connect">
    <section v-if="setup" class="card steps" :aria-busy="busy">
      <div class="card-head">
        <div>
          <span class="eyebrow">连接 QQ</span>
          <h2>QQ 接入助手</h2>
          <p>
            LuckyBot 自动写入 OneBot 反向连接并启动 NapCat；QQ 登录仍由 QQ
            自己扫码确认。
          </p>
        </div>
        <span class="pill"
          ><span class="dot" :class="{ off: !online }"></span
          >{{ online ? "QQ 已连接" : "等待 QQ" }}</span
        >
      </div>
      <p v-if="busy" role="status" class="notice">正在处理，请稍候…</p>
      <fieldset :disabled="busy" class="qq-steps">
        <article class="step">
          <span class="num">1</span>
          <div>
            <b>准备 QQ 通道</b>
            <p class="muted">
              项目已内置官方 NapCat 包
              {{ setup.bundledInstaller?.version || "" }}。
            </p>
            <div class="row">
              <button
                id="installNapcat"
                type="button"
                @click="run(() => install(false))"
              >
                使用内置安装器
              </button>
              <button
                id="checkNapcatUpdate"
                type="button"
                @click="run(checkUpdate)"
              >
                检查更新
              </button>
            </div>
            <small id="napcatUpdateResult" class="faint">{{
              updateText
            }}</small>
          </div>
        </article>
        <article class="step">
          <span class="num">2</span>
          <div>
            <b>选择安装目录并自动配置</b>
            <div class="row path">
              <input
                id="napcatRoot"
                v-model="root"
                placeholder="选择或粘贴 NapCat 根目录"
              />
              <button id="pickNapcat" type="button" @click="run(pick)">
                选择目录
              </button>
            </div>
            <div class="row">
              <button
                id="configureNapcat"
                type="button"
                class="primary"
                @click="run(configure)"
              >
                生成连接配置
              </button>
              <select
                v-if="setup.installation?.accountFiles?.length"
                id="napcatAccount"
                v-model="account"
              >
                <option value="">默认配置（下次登录适用）</option>
                <option
                  v-for="a in setup.installation.accountFiles"
                  :key="a.id"
                  :value="a.id"
                >
                  QQ {{ a.id }}
                </option>
              </select>
            </div>
          </div>
        </article>
        <article class="step">
          <span class="num">3</span>
          <div>
            <b>启动并扫码登录</b>
            <p class="muted">
              NapCat 启动后在弹出的窗口里扫码；连上以后右上角会显示「QQ
              已连接」。
            </p>
            <button
              id="launchNapcat"
              type="button"
              class="primary"
              :disabled="!root"
              @click="run(launch)"
            >
              启动 NapCat 并登录 QQ
            </button>
          </div>
        </article>
      </fieldset>
    </section>

    <section class="card checklist">
      <div class="card-head">
        <div>
          <span class="eyebrow">就绪检查</span>
          <h2>还差哪一步</h2>
        </div>
        <span class="chip"
          >{{ studio.health.readiness?.completed ?? 0 }} /
          {{ studio.health.readiness?.total ?? 0 }}</span
        >
      </div>
      <ol class="checks">
        <li
          v-for="c in studio.health.readiness?.checks || []"
          :key="c.id"
          :class="{ done: c.done }"
        >
          <span class="mark" aria-hidden="true">{{ c.done ? "✓" : "" }}</span>
          <div>
            <b>{{ c.name }}</b>
            <small class="muted">{{ c.detail }}</small>
          </div>
          <button class="small" :data-fix="c.id" @click="fix(c.id)">
            {{ c.done ? "查看" : "去处理" }}
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.connect {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
  gap: var(--gap);
  align-items: start;
}
.qq-steps {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: none;
}
.step {
  display: flex;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
  border: 1px solid var(--line);
}
.step > div {
  flex: 1;
  display: grid;
  gap: 8px;
  min-width: 0;
}
.num {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
}
.path input {
  flex: 1 1 220px;
}
#napcatAccount {
  width: auto;
}
.checks {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.checks li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
  border: 1px solid var(--line);
}
.checks li > div {
  flex: 1;
  display: grid;
  min-width: 0;
}
.checks small {
  font-size: 12px;
}
.mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--line);
  font-size: 11px;
  font-weight: 700;
}
.done .mark {
  border-color: var(--ok);
  background: var(--ok);
  color: var(--accent-ink);
}
@media (max-width: 1000px) {
  .connect {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
