<script setup lang="ts">
import { onMounted, ref } from "vue";
import { studio, go } from "../store";
import { toast } from "../api";
import {
  checkQQClientUpdate,
  configureQq,
  installQQClient,
  launchQQClient,
  pickQQClientFolder,
  prepareQqToken,
  qqSetup,
} from "../plates/connect";

const setup = ref<any>(null);
const root = ref("");
const updateText = ref("");
const account = ref("");

async function load() {
  setup.value = await qqSetup();
  root.value = setup.value.root || "";
}

onMounted(load);

async function install(latest = false) {
  const result = await installQQClient(latest);
  root.value = result.root;
  await load();
  toast("安装器已处理");
}

async function checkUpdate() {
  const update = await checkQQClientUpdate();
  updateText.value = update.message || JSON.stringify(update);
}

async function pick() {
  const result = await pickQQClientFolder();
  root.value = result.root;
}

async function configure() {
  await prepareQqToken();
  await configureQq({
    root: root.value,
    accountId: account.value,
  });
  await load();
  toast("已写入 OneBot 反向连接");
}

async function launch() {
  await launchQQClient(root.value);
  toast("已尝试启动 QQClient");
}
</script>

<template>
  <section class="panel" v-if="setup">
    <div class="card-head">
      <h2>QQ 接入助手</h2>
      <span class="pill">{{
        studio.health.connection.online ? "QQ 已连接" : "等待 QQ"
      }}</span>
    </div>
    <p class="small">
      LuckyBot 自动写入 OneBot 反向连接并启动 QQClient；QQ 登录仍由 QQ
      自己扫码确认。
    </p>
    <div class="qq-steps">
      <article>
        <span>1</span>
        <div>
          <b>准备 QQ 通道</b>
          <p>
            项目已内置官方 QQClient 包
            {{ setup.bundledInstaller?.version || "" }}。
          </p>
          <div class="row">
            <button type="button" id="installQQClient" @click="install(false)">
              使用内置安装器
            </button>
            <button type="button" id="checkQQClientUpdate" @click="checkUpdate">
              检查更新
            </button>
          </div>
          <small id="qqclientUpdateResult">{{ updateText }}</small>
        </div>
      </article>
      <article>
        <span>2</span>
        <div>
          <b>选择安装目录并自动配置</b>
          <div class="qq-path">
            <input
              id="qqclientRoot"
              v-model="root"
              placeholder="选择或粘贴 QQClient 根目录"
            />
            <button type="button" id="pickQQClient" @click="pick">
              选择目录
            </button>
          </div>
          <div class="row">
            <button
              type="button"
              class="primary"
              id="configureQQClient"
              @click="configure"
            >
              生成连接配置
            </button>
            <select
              v-if="setup.installation?.accountFiles?.length"
              id="qqclientAccount"
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
      <article>
        <span>3</span>
        <div>
          <b>启动并扫码登录</b>
          <button
            type="button"
            class="primary"
            id="launchQQClient"
            :disabled="!root"
            @click="launch"
          >
            启动 QQClient 并登录 QQ ↗
          </button>
        </div>
      </article>
    </div>
  </section>
  <section class="panel">
    <h2>还差哪一步</h2>
    <article
      v-for="(c, i) in studio.health.readiness?.checks || []"
      :key="c.name"
      class="onboarding-step"
    >
      <h4>{{ c.name }}</h4>
      <p class="small">{{ c.detail }}</p>
      <button
        class="text-button"
        @click="
          go(
            c.tab === 'sessions'
              ? 'spaces'
              : c.tab === 'settings'
                ? 'models'
                : c.tab === 'setup'
                  ? 'connect'
                  : c.tab === 'persona'
                    ? 'character'
                    : 'overview',
          )
        "
      >
        {{ c.done ? "查看配置" : "去完成" }}
      </button>
    </article>
  </section>
</template>
