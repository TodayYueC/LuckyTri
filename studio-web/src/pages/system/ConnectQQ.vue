<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { api, toast } from "../../api";
import { ask } from "../../dialog";
import { ago } from "../../format";
import { localized, N_, t } from "../../i18n";
import { go, reload, studio } from "../../stores/studio";
import type { Page } from "../../router";
import Tabs from "../../components/ui/Tabs.vue";

type Channel = "onebot" | "qqbot";

const emit = defineEmits<{ open: [sub: string] }>();

const connection = computed(() => studio.health.connection || {});
const active = computed<Channel>(() =>
  connection.value.channel === "qqbot" ? "qqbot" : "onebot",
);
const locked = computed(() => Boolean(connection.value.locked));
const online = computed(() => Boolean(connection.value.online));
const onebot = computed(() => connection.value.onebot || {});
const qqbot = computed(() => connection.value.qqbot || {});
const savedAppId = computed(() =>
  String(studio.health.settings.qqbotAppId || ""),
);
const secretSaved = computed(() =>
  Boolean(studio.health.settings.hasQqbotSecret),
);

// Which method's page is open. It starts on the one in use and follows it
// when it changes; looking at the other one does not switch anything.
const viewing = ref<Channel>(active.value);
watch(active, (value) => (viewing.value = value));

const wsUrl = computed(
  () =>
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/onebot/v11/ws`,
);

const tabs = computed(() => [
  {
    key: "onebot",
    label: t("OneBot 11"),
    count: active.value === "onebot" ? t("使用中") : "",
  },
  {
    key: "qqbot",
    label: t("QQ 官方机器人"),
    count: active.value === "qqbot" ? t("使用中") : "",
  },
]);

const draft = reactive({ appId: savedAppId.value, secret: "" });
const busy = ref(false);
const changed = computed(
  () => draft.appId.trim() !== savedAppId.value || Boolean(draft.secret.trim()),
);
watch(changed, (value) => {
  studio.dirty = value;
});
watch(savedAppId, (value) => {
  if (!changed.value) draft.appId = value;
});
onUnmounted(() => {
  studio.dirty = false;
});

const ready = computed(
  () =>
    Boolean(draft.appId.trim()) &&
    (secretSaved.value || Boolean(draft.secret.trim())),
);
const STATES: Record<string, string> = localized({
  idle: N_("未启用"),
  unconfigured: N_("尚未填写 AppID 与 AppSecret"),
  connecting: N_("正在连接开放平台"),
  ready: N_("已连接"),
  closed: N_("连接已断开，正在重连"),
  error: N_("连接出错"),
});
const SCOPES: Record<string, string> = localized({
  all: N_("全部群消息"),
  mentions: N_("只有 @ 她的消息"),
  unknown: N_("尚未收到群消息"),
});
const stateText = computed(
  () => STATES[qqbot.value.state || "idle"] ?? STATES.idle,
);
const scopeText = computed(
  () => SCOPES[qqbot.value.groupMessages || "unknown"] ?? SCOPES.unknown,
);
const showScopeHint = computed(
  () => active.value === "qqbot" && qqbot.value.groupMessages === "mentions",
);

async function activate(channel: Channel) {
  if (busy.value || locked.value || channel === active.value) return;
  const name = channel === "qqbot" ? t("QQ 官方机器人") : t("OneBot 11");
  if (
    online.value &&
    !(await ask(
      t(
        "切换后会断开当前连接。原来方式下的会话仍可查看，但不能再向它们发送消息。",
      ),
      {
        title: t("切换连接方式"),
        confirmText: t("切换"),
        cancelText: t("先不切换"),
      },
    ))
  )
    return;
  busy.value = true;
  try {
    await api("/settings", "PATCH", { channel });
    await reload();
    toast(t("已切换为 {name}", { name }));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function saveQqbot() {
  if (busy.value) return;
  if (!ready.value) {
    toast(t("请填写 AppID 和 AppSecret"), true);
    return;
  }
  busy.value = true;
  try {
    const body: Record<string, unknown> = {
      qqbotAppId: draft.appId.trim(),
    };
    if (draft.secret.trim()) body.qqbotSecret = draft.secret.trim();
    if (active.value !== "qqbot" && !locked.value) body.channel = "qqbot";
    await api("/settings", "PATCH", body);
    draft.secret = "";
    await reload();
    toast(t("已保存"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

const FIX: Record<string, [Page | "", string]> = {
  token: ["", "connect"],
  credentials: ["", "connect"],
  qq: ["", "connect"],
  model: ["", "models"],
  mode: ["", "runtime"],
  session: ["chats", ""],
  persona: ["nature", ""],
};

function fix(id: string) {
  const [page, sub] = FIX[id] || ["", "connect"];
  if (page) go(page);
  else emit("open", sub);
}
</script>

<template>
  <div class="connect">
    <section class="card connection">
      <div class="card-head">
        <div>
          <span class="eyebrow">{{ t("QQ") }}</span>
          <h2>{{ t("连接 QQ") }}</h2>
          <p>
            {{
              t(
                "两种连接方式二选一，同一时间只使用一种。她的记忆、心情和行为完全一致，区别只在消息怎么到达。",
              )
            }}
          </p>
        </div>
        <span class="pill">
          <span class="dot" :class="{ off: !online }"></span>
          {{ online ? t("QQ 已连接") : t("等待连接") }}
        </span>
      </div>

      <Tabs v-model="viewing" :label="t('连接方式')" :items="tabs" />
      <p v-if="locked" class="notice" role="note">
        {{
          t(
            "连接方式由环境变量 LUCKYTRI_CHANNEL 指定，在这里不能更改。去掉该变量后即可在此选择。",
          )
        }}
      </p>

      <template v-if="viewing === 'onebot'">
        <p class="muted">
          {{ t("自备接入端，通过反向 WebSocket 连接。能看到全部群消息。") }}
        </p>
        <div class="connection-details">
          <div class="detail">
            <span>{{ t("反向 WebSocket 地址") }}</span>
            <code>{{ wsUrl }}</code>
          </div>
        </div>
        <ol class="instructions">
          <li>
            {{ t("同一台电脑上的接入端无需单独配置连接令牌。") }}
          </li>
          <li>
            {{
              t(
                "在接入端启用反向 WebSocket 客户端，填写上方地址，消息格式选择数组。已有的地址配置可以继续使用。",
              )
            }}
          </li>
          <li>
            {{
              t(
                "在接入端完成 QQ 登录。连接成功后，本页状态会更新；新会话仍需在「对话」中开启参与。",
              )
            }}
          </li>
        </ol>
        <p class="muted">
          {{
            t("远程接入时，连接密码使用管理密码；已有的远程连接令牌仍兼容。")
          }}
        </p>
        <p class="muted note">
          {{ t("LuckyTri 只负责接收，不提供、不安装也不管理接入端。") }}
        </p>
        <div v-if="active !== 'onebot'" class="row">
          <button
            class="primary"
            data-use="onebot"
            :disabled="busy || locked"
            @click="activate('onebot')"
          >
            {{ t("改用这种方式") }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="muted">
          {{
            t(
              "只需 AppID 与 AppSecret，无需额外软件。群里默认只收到 @ 她的消息。",
            )
          }}
        </p>
        <form class="stack tight" @submit.prevent="saveQqbot">
          <label>
            {{ t("AppID") }}
            <input
              v-model="draft.appId"
              name="qqbotAppId"
              autocomplete="off"
              inputmode="numeric"
              maxlength="40"
              :disabled="busy || qqbot.appIdFromEnv"
              :placeholder="t('机器人的 AppID')"
            />
            <small v-if="qqbot.appIdFromEnv" class="faint">{{
              t("由环境变量指定，在这里不能修改")
            }}</small>
          </label>
          <label>
            {{ t("AppSecret") }}
            <input
              v-model="draft.secret"
              name="qqbotSecret"
              type="password"
              autocomplete="new-password"
              maxlength="200"
              :disabled="busy || qqbot.secretFromEnv"
              :placeholder="
                secretSaved || qqbot.secretFromEnv
                  ? t('已保存，留空保留')
                  : t('机器人的 AppSecret')
              "
            />
            <small v-if="qqbot.secretFromEnv" class="faint">{{
              t("由环境变量指定，在这里不能修改")
            }}</small>
          </label>
          <div class="row">
            <button
              class="primary"
              data-save="qqbot"
              :disabled="busy || (qqbot.appIdFromEnv && qqbot.secretFromEnv)"
            >
              {{ active === "qqbot" || locked ? t("保存") : t("保存并使用") }}
            </button>
            <span v-if="changed" class="faint">{{
              t("有尚未保存的修改")
            }}</span>
          </div>
        </form>

        <div v-if="active === 'qqbot'" class="connection-details">
          <div class="detail">
            <span>{{ t("连接状态") }}</span>
            <strong data-state>{{ stateText }}</strong>
          </div>
          <div v-if="qqbot.error" class="detail">
            <span></span>
            <small class="warn-text">{{ qqbot.error }}</small>
          </div>
          <div v-if="qqbot.botName" class="detail">
            <span>{{ t("机器人") }}</span>
            <strong>{{ qqbot.botName }}</strong>
          </div>
          <div class="detail">
            <span>{{ t("最近收到消息") }}</span>
            <strong>{{
              qqbot.lastEventAt ? ago(qqbot.lastEventAt) : t("还没有")
            }}</strong>
          </div>
          <div class="detail">
            <span>{{ t("群消息范围") }}</span>
            <strong>{{ scopeText }}</strong>
          </div>
        </div>
        <p v-if="showScopeHint" class="notice" role="note">
          {{
            t(
              "目前只收到 @ 她的群消息。想让她看到群里的全部消息，请在开放平台的机器人设置里开启「接收所有消息」。",
            )
          }}
        </p>

        <ol class="instructions">
          <li>
            {{ t("在 QQ 开放平台创建机器人，取得 AppID 与 AppSecret。") }}
          </li>
          <li>
            {{
              t("把运行 LuckyTri 的这台机器的出口 IP 加入机器人的 IP 白名单。")
            }}
          </li>
          <li>
            {{
              t(
                "可选：开启「接收所有消息」，她才能看到群里没有 @ 她的话；不开启时只会收到 @ 她的消息。",
              )
            }}
          </li>
          <li>
            {{
              t(
                "填写上方的 AppID 与 AppSecret 并保存。状态变为「已连接」后，在群里 @ 她或私聊她，新会话会出现在「对话」中。",
              )
            }}
          </li>
        </ol>
        <ul class="muted notes">
          <li>
            {{
              t(
                "官方平台不提供群名称：新会话以占位名出现，可以在「对话」中为它改名。",
              )
            }}
          </li>
          <li>
            {{
              t(
                "官方平台上，同一个人在不同的群里标识不同。像只在不同的房间见过对方一样，平台给出统一身份之前，她不会把两处的人当成同一个人。",
              )
            }}
          </li>
          <li>
            {{
              t("对方关闭了机器人的主动消息时，她不会去打扰，会等对方来找她。")
            }}
          </li>
        </ul>
      </template>
    </section>

    <section class="card checklist">
      <div class="card-head">
        <div>
          <span class="eyebrow">{{ t("就绪检查") }}</span>
          <h2>{{ t("还差哪一步") }}</h2>
        </div>
        <span class="chip">
          {{ studio.health.readiness?.completed ?? 0 }} /
          {{ studio.health.readiness?.total ?? 0 }}
        </span>
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
            {{ c.done ? t("查看") : t("去处理") }}
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.connect {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(290px, 0.9fr);
  gap: var(--gap);
  align-items: start;
}
.connection {
  display: grid;
  gap: 20px;
}
.connection-details {
  display: grid;
  gap: 10px;
}
.detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 13px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
}
.detail code {
  overflow-wrap: anywhere;
}
.warn-text {
  color: var(--warn);
  overflow-wrap: anywhere;
}
.instructions {
  display: grid;
  gap: 11px;
  padding-left: 22px;
  margin: 0;
  line-height: 1.65;
}
.notes {
  display: grid;
  gap: 8px;
  padding-left: 20px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
.note {
  margin: -8px 0 0;
  font-size: 12px;
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
