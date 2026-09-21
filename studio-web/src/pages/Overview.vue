<script setup lang="ts">
import { studio, go } from "../store";
import { toast } from "../api";
import { patchSettings, fetchState } from "../plates/workspace";

const health = () => studio.health;
const core = () => studio.core;

async function saveRuntime(e: Event) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  await patchSettings({
    enabled: (form.elements.namedItem("enabled") as HTMLInputElement).checked,
    demo: (form.elements.namedItem("demo") as HTMLInputElement).checked,
  });
  studio.dirty = false;
  studio.health = await fetchState();
  toast("已保存并应用");
}
</script>

<template>
  <section class="welcome-card">
    <div class="welcome-copy">
      <div class="eyebrow">A LITTLE LUCK, EVERY DAY</div>
      <h2>让对话，自然发生<span>。</span></h2>
      <p>留一点空间给陪伴，留一点记忆给日常。<br />今天的故事，从这里继续。</p>
      <button class="primary" @click="go('live')">进入实时会话 ↗</button>
    </div>
    <div class="welcome-art" aria-hidden="true">
      <div class="orbit orbit-one"></div>
      <div class="orbit orbit-two"></div>
      <div class="lucky-star">✦</div>
      <span class="art-caption">STAY / CONNECTED</span
      ><span class="art-index">01</span>
    </div>
  </section>
  <div class="grid">
    <section class="panel">
      <h2>QQ 连接</h2>
      <div class="stat">{{ health().connection.online ? "在线" : "离线" }}</div>
      <button class="text-button" data-page="connect" @click="go('connect')">
        管理连接与安装
      </button>
    </section>
    <section class="panel">
      <h2>正在参与</h2>
      <div class="stat">
        {{
          core().sessions.filter((s: any) => s.enabled && !s.archived).length
        }}
        个会话
      </div>
    </section>
    <section class="panel">
      <h2>模型档案</h2>
      <div class="stat">{{ core().models.length }} 个</div>
      <p class="small">管理已连接的模型与思考设置</p>
    </section>
  </div>
  <section class="panel">
    <h2>最近互动</h2>
    <p
      v-for="d in health().decisions.slice(0, 8)"
      :key="d.id"
      class="activity-item"
    >
      <span class="small"
        >{{ new Date(d.time).toLocaleTimeString() }} · {{ d.emotion }}</span
      ><br />
      {{ d.reason }}
      <template v-if="d.reply"><br />{{ d.reply }}</template>
    </p>
    <p v-if="!health().decisions.length" class="small">还没有决策记录。</p>
  </section>
  <section class="panel">
    <h2>运行开关</h2>
    <form id="runtime" @submit="saveRuntime" @input="studio.dirty = true">
      <label class="check"
        ><input
          name="enabled"
          type="checkbox"
          :checked="health().settings.enabled"
        />允许 LuckyBot 参与聊天</label
      >
      <label class="check"
        ><input
          name="demo"
          type="checkbox"
          :checked="health().settings.demo"
        />仅模拟运行（消息不会发送到 QQ）</label
      >
      <button class="primary" type="submit">保存并应用</button>
      <span class="small">保存后下一轮生效</span>
    </form>
  </section>
</template>
