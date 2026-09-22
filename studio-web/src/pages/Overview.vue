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
  <div class="today-layout">
    <section class="today-hero">
      <div class="hero-topline">
        <span>DAILY CONNECTION</span><span>LUCKYBOT / ONLINE LIFE</span>
      </div>
      <div class="hero-copy">
        <h2>STAY<br /><em>IN SYNC.</em></h2>
        <p>日常，因回应而鲜活。</p>
        <button class="primary" @click="go('live')">
          进入对话现场 <span>↗</span>
        </button>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-ring ring-a"></div>
        <div class="hero-ring ring-b"></div>
        <span class="hero-star">✦</span
        ><span class="hero-axis">SOCIAL / LINK</span
        ><span class="hero-stamp">L.</span>
      </div>
      <div class="hero-bottom">
        <span>感受当下 / 留住回响</span><span>01 — EVERYDAY</span>
      </div>
    </section>
    <section class="today-control surface">
      <div class="section-heading">
        <h2>运行状态</h2>
        <span class="eyebrow">CONTROL</span>
      </div>
      <div class="connection-display">
        <i :class="{ online: health().connection.online }"></i
        ><strong>{{ health().connection.online ? "连接中" : "未连接" }}</strong
        ><button data-page="connect" @click="go('connect')">管理连接 ↗</button>
      </div>
      <div class="metric-pair">
        <button @click="go('spaces')">
          <strong>{{
            core().sessions.filter((s: any) => s.enabled && !s.archived).length
          }}</strong
          ><span>参与会话 ↗</span></button
        ><button @click="go('models')">
          <strong>{{ core().models.length }}</strong
          ><span>可用模型 ↗</span>
        </button>
      </div>
      <form id="runtime" @submit="saveRuntime" @input="studio.dirty = true">
        <label class="check"
          ><input
            name="enabled"
            type="checkbox"
            :checked="health().settings.enabled"
          />允许参与聊天</label
        ><label class="check"
          ><input
            name="demo"
            type="checkbox"
            :checked="health().settings.demo"
          />仅模拟运行，不向 QQ 发送</label
        ><button class="primary" type="submit">保存运行状态 ↗</button>
      </form>
    </section>
    <section class="today-feed surface">
      <div class="section-heading">
        <h2>最近互动</h2>
        <button @click="go('live')">查看现场 ↗</button>
      </div>
      <div class="feed-scroll">
        <article
          v-for="d in health().decisions.slice(0, 12)"
          :key="d.id"
          class="activity-item"
        >
          <time>{{ new Date(d.time).toLocaleTimeString() }}</time
          ><span class="status-tag">{{ d.reply ? "已回应" : "在旁听" }}</span>
          <p>{{ d.reply || d.reason }}</p>
          <details v-if="d.reply">
            <summary>查看原因</summary>
            <p>{{ d.reason }}</p>
          </details>
        </article>
        <div v-if="!health().decisions.length" class="empty-state">
          <span>◌</span>
          <h3>故事还没开始</h3>
          <p>连接 QQ 并启用会话后，互动会显示在这里。</p>
          <button @click="go('connect')">完成连接 ↗</button>
        </div>
      </div>
    </section>
    <section class="today-note">
      <span class="eyebrow">MAKE IT YOURS</span>
      <h2>让她有自己的<br /><em>表达方式。</em></h2>
      <p>设定性格，再用一句话感受变化。</p>
      <button @click="go('character')">编辑人格 ↗</button
      ><span class="note-star" aria-hidden="true">✦</span>
    </section>
  </div>
</template>
