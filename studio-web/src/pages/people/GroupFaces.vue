<script setup lang="ts">
import { ref } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { mind, when } from "../../plates/mind";
import { hueOf } from "../../format";

defineProps<{ groups: any[] }>();
const emit = defineEmits<{ changed: [] }>();
const history = ref<Record<string, any[]>>({});

async function toggle(session: string) {
  if (history.value[session]) {
    const { [session]: _drop, ...rest } = history.value;
    history.value = rest;
    return;
  }
  history.value = { ...history.value, [session]: await mind.faces(session) };
}

async function revoke(session: string, id: string) {
  if (
    !(await ask("撤销这一版面貌？TA 在这里会回到上一版的样子。", {
      title: "撤销面貌",
      confirmText: "撤销",
      danger: true,
    }))
  )
    return;
  try {
    await mind.revoke("face", id);
    history.value = { ...history.value, [session]: await mind.faces(session) };
    toast("已撤销");
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <section class="faces">
    <div class="faces-head">
      <span class="eyebrow">FACES</span>
      <h2>群像：TA 在每个地方的样子</h2>
      <p class="muted">
        面貌由 TA
        在独处和写日记时自己修正，吸收那个群的说话习惯；每一版都有来源。
      </p>
    </div>
    <div class="face-grid">
      <article
        v-for="g in groups"
        :key="g.session"
        class="card face-card"
        :style="{ '--hue': hueOf(g.session) }"
      >
        <header>
          <span class="badge">{{ g.kind === "private" ? "私" : "群" }}</span>
          <div>
            <h3>{{ g.name }}</h3>
            <small class="muted"
              >{{ g.kind === "private" ? "私聊" : "群聊"
              }}{{ g.bond ? ` · ${g.bond.feel}` : "" }}</small
            >
          </div>
        </header>
        <dl v-if="g.face" class="kv">
          <dt>角色</dt>
          <dd>{{ g.face.role || "—" }}</dd>
          <dt>说话</dt>
          <dd>{{ g.face.tone || "—" }}</dd>
          <dt>想成为</dt>
          <dd>{{ g.face.aspiration || "—" }}</dd>
          <template v-if="g.face.content">
            <dt>自己的话</dt>
            <dd>{{ g.face.content }}</dd>
          </template>
        </dl>
        <p v-else class="muted small-text">还没有形成在这里的样子。</p>
        <button class="text-button" @click="toggle(g.session)">
          {{ history[g.session] ? "收起变化" : "变化历史" }}
        </button>
        <ol v-if="history[g.session]" class="versions">
          <li
            v-for="f in history[g.session]"
            :key="f.id"
            :class="{ revoked: f.revoked }"
          >
            <time>{{ when(f.created) }}</time>
            <span>
              <b v-if="f.revoked">已撤销 · </b
              ><b v-else-if="f.origin === 'migration'">旧版 · </b
              >{{
                [f.role, f.tone, f.aspiration].filter(Boolean).join(" · ") ||
                f.content
              }}
            </span>
            <button
              v-if="!f.revoked"
              class="text-button"
              @click="revoke(g.session, f.id)"
            >
              撤销
            </button>
          </li>
          <li v-if="!history[g.session].length" class="muted">没有记录。</li>
        </ol>
      </article>
    </div>
  </section>
</template>

<style scoped>
.faces {
  display: grid;
  gap: 14px;
}
.faces-head h2 {
  font-size: 19px;
}
.faces-head p {
  margin-top: 4px;
  font-size: 13px;
}
.face-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--gap);
}
.face-card {
  display: grid;
  align-content: start;
  gap: 12px;
}
.face-card header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.face-card h3 {
  font-size: 16px;
}
.badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: hsl(var(--hue) 70% 88%);
  color: hsl(var(--hue) 45% 25%);
  font-weight: 700;
}
.face-card .text-button {
  justify-self: start;
}
.small-text {
  font-size: 13px;
}
.versions {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
}
.versions li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: baseline;
}
.versions time {
  color: var(--ink-soft);
}
.versions li.revoked {
  opacity: 0.55;
}
</style>
