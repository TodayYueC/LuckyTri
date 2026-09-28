<script setup lang="ts">
import { computed } from "vue";
import { go, studio } from "../../stores/studio";
import type { Page } from "../../router";

const emit = defineEmits<{ open: [sub: string] }>();
const online = computed(() => Boolean(studio.health.connection?.online));
const tokenConfigured = computed(() =>
  Boolean(studio.health.connection?.tokenConfigured),
);
const wsUrl = computed(
  () =>
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/onebot/v11/ws`,
);
const FIX: Record<string, [Page | "", string]> = {
  token: ["", "connect"],
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
          <span class="eyebrow">ONEBOT 11</span>
          <h2>连接 QQ</h2>
          <p>
            LuckyTri 接收标准 OneBot 11 反向 WebSocket
            连接。接入端由你独立安装和管理。
          </p>
        </div>
        <span class="pill">
          <span class="dot" :class="{ off: !online }"></span>
          {{ online ? "QQ 已连接" : "等待连接" }}
        </span>
      </div>

      <div class="connection-details">
        <div class="detail">
          <span>反向 WebSocket 地址</span>
          <code>{{ wsUrl }}</code>
        </div>
        <div class="detail">
          <span>连接令牌</span>
          <strong>{{ tokenConfigured ? "已配置" : "尚未配置" }}</strong>
        </div>
      </div>

      <ol class="instructions">
        <li>
          在本机 <code>.env</code> 中设置 <code>ONEBOT_TOKEN</code>，修改后重启
          LuckyTri。
        </li>
        <li>
          自行选择 OneBot 11 接入端，在其设置中启用反向 WebSocket
          客户端，填写上方地址和相同令牌，消息格式选择数组。
        </li>
        <li>
          在接入端完成 QQ
          登录。连接成功后，本页状态会更新；新会话仍需在「对话」中开启参与。
        </li>
      </ol>

      <a
        class="official-link"
        href="https://github.com/NapNeko/NapCatQQ"
        target="_blank"
        rel="noopener noreferrer"
        >前往 NapCat 官方仓库 ↗</a
      >
      <p class="muted note">
        NapCat 是独立项目。LuckyTri 不提供其安装包、下载、配置或启动功能。
      </p>
    </section>

    <section class="card checklist">
      <div class="card-head">
        <div>
          <span class="eyebrow">就绪检查</span>
          <h2>还差哪一步</h2>
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
.instructions {
  display: grid;
  gap: 11px;
  padding-left: 22px;
  margin: 0;
  line-height: 1.65;
}
.official-link {
  display: inline-flex;
  width: fit-content;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  text-decoration: none;
  font-weight: 700;
  transition:
    transform 180ms ease,
    filter 180ms ease;
}
.official-link:hover {
  transform: translateY(-2px);
  filter: brightness(1.05);
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
