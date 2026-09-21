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
  <div class="notice">
    消息归档 → 语境装配（批次与引用链优先）→ 发言决策 → 生成校验 →
    气泡发送。知识检索只作为数据包进入装配，不会绕过该不该说话。
  </div>
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
      <p class="small">输入、输出预算与 embedding 能力分开配置</p>
    </section>
  </div>
  <section class="panel">
    <h2>最近为何说 / 不说</h2>
    <p
      v-for="d in health().decisions.slice(0, 8)"
      :key="d.id"
      :class="{ danger: !d.reply }"
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
        />全局启用</label
      >
      <label class="check"
        ><input
          name="demo"
          type="checkbox"
          :checked="health().settings.demo"
        />模拟模式（不发 QQ）</label
      >
      <button class="primary" type="submit">保存并应用</button>
      <span class="small">保存后下一轮生效</span>
    </form>
  </section>
</template>
