<script setup lang="ts">
import Sheet from "../../components/ui/Sheet.vue";
import { ref } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { mind, when } from "../../plates/mind";
import { hueOf, placeName } from "../../format";

defineProps<{ groups: any[] }>();
const emit = defineEmits<{ changed: [] }>();
const selected = ref<any>(null);
const history = ref<Record<string, any[]>>({});

async function toggle(session: string) {
  if (history.value[session]) {
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
      <span class="eyebrow">群像</span>
      <h2>在不同的地方，她有不同的相处方式。</h2>
      <p class="muted">
        面貌由 TA
        在独处和写日记时自己修正；每一版都有来源。这个地方的说话节奏不会写成 TA
        的样子。
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
            <h3>
              {{ placeName({ id: g.session, name: g.name, kind: g.kind }) }}
            </h3>
            <small v-if="g.kind === 'private'" class="qq"
              >QQ
              {{
                String(g.session || "")
                  .split(":")
                  .pop()
              }}</small
            >
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
            <dd class="face-excerpt">{{ g.face.content }}</dd>
          </template>
        </dl>
        <p v-else class="muted small-text">还没有形成在这里的样子。</p>
        <button
          class="text-button"
          @click="
            selected = g;
            toggle(g.session);
          "
        >
          查看完整面貌与变化 ↗
        </button>
      </article>
    </div>
    <Sheet
      :open="!!selected"
      :title="selected?.name || '面貌'"
      eyebrow="FACES / 在这里的样子"
      width="680px"
      @close="selected = null"
      ><div v-if="selected" class="stack">
        <p class="face-full">
          {{ selected.face?.content || "还没有形成在这里的样子。" }}
        </p>
        <h3>变化历史</h3>
        <ol v-if="history[selected.session]" class="versions">
          <li
            v-for="f in history[selected.session]"
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
              @click="revoke(selected.session, f.id)"
            >
              撤销
            </button>
          </li>
          <li v-if="!history[selected.session].length" class="muted">
            没有记录。
          </li>
        </ol>
      </div></Sheet
    >
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
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: var(--gap);
  align-items: stretch;
}
.face-card {
  display: flex;
  flex-direction: column;
  align-content: start;
  gap: 12px;
  height: 100%;
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
  margin-top: auto;
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
.face-excerpt {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.face-full {
  white-space: pre-wrap;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.face-card .kv {
  align-content: start;
}
.face-card .kv dd {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.face-card .kv dd.face-excerpt {
  -webkit-line-clamp: 4;
}
.versions li {
  grid-template-columns: 1fr auto;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.versions time {
  grid-column: 1 / -1;
}
.faces {
  gap: 19px;
}
.faces-head {
  padding: 0 4px;
}
.faces-head h2 {
  margin-top: 5px;
  font-size: clamp(19px, 2vw, 25px);
  letter-spacing: -0.025em;
}
.faces-head p {
  max-width: 68ch;
  line-height: 1.7;
}
.face-grid {
  align-items: start;
  gap: 15px;
}
.face-card {
  isolation: isolate;
  overflow: hidden;
  height: auto;
  min-height: 230px;
  max-height: 430px;
  padding: 19px;
  border-radius: 27px;
  border: 1px solid #ffffffe8;
  background: linear-gradient(
    137deg,
    #ffffffd0,
    #ffffff69 65%,
    hsl(var(--hue) 78% 89% / 0.48)
  );
  box-shadow:
    inset 0 2px 0 #fff,
    0 18px 32px -26px #5f83b1;
  transition:
    transform 0.45s var(--spring),
    box-shadow 0.28s;
}
.face-card::before {
  content: "";
  position: absolute;
  z-index: -1;
  width: 145px;
  height: 145px;
  right: -70px;
  top: -73px;
  border-radius: 50%;
  background: hsl(var(--hue) 75% 80% / 0.55);
  filter: blur(27px);
}
.face-card:hover {
  transform: translateY(-5px) scale(1.012);
  box-shadow:
    inset 0 2px 0 #fff,
    0 24px 39px -26px #688cb7;
}
.face-card header {
  border-bottom: 1px solid #ffffffc7;
  padding-bottom: 12px;
}
.face-card header > div {
  min-width: 0;
}
.face-card h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid #fff;
  background: radial-gradient(
    circle at 25% 20%,
    #fff,
    hsl(var(--hue) 72% 84%) 62%,
    hsl(var(--hue) 65% 75%)
  );
  box-shadow:
    inset 2px 2px 4px #fff,
    0 7px 15px -10px #6587b4;
}
.face-card .kv {
  gap: 5px 12px;
  line-height: 1.55;
  min-height: 0;
  overflow: hidden;
}
.face-card .kv dt {
  font-size: 11px;
}
.face-card .kv dd {
  font-size: 12px;
}
.face-card .kv dd.face-excerpt {
  -webkit-line-clamp: 3;
}
.face-card .text-button {
  margin-top: auto;
  align-self: start;
  padding: 5px 9px;
  border: 1px solid #fff;
  border-radius: 99px;
  background: #ffffffa1;
  text-decoration: none;
  transition: transform 0.38s var(--spring);
}
.face-card .text-button:hover:not(:disabled) {
  transform: translateX(4px);
}
.face-full {
  padding: 17px;
  border-radius: 20px;
  border: 1px solid #fff;
  background: #ffffff91;
  box-shadow: inset 0 1px 0 #fff;
}
.versions li {
  padding: 10px 12px;
  border-radius: 15px;
  border: 1px solid #fff;
  background: #ffffff91;
}
</style>
