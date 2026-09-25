<script setup lang="ts">
import { ref } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { OUTREACH_STATUS, mind, when } from "../../plates/mind";
import Empty from "../../components/ui/Empty.vue";

const props = defineProps<{
  thoughts: any[];
  kinds: Record<string, string>;
  query: string;
}>();
const emit = defineEmits<{ changed: []; search: [q: string] }>();
const q = ref(props.query);

async function update(t: any, value: Record<string, unknown>) {
  try {
    await mind.thought(t.id, value);
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function remove(t: any) {
  if (
    !(await ask("删除这张便签？有后续修正的便签只能隐藏。", {
      title: "删除便签",
      confirmText: "删除",
      danger: true,
    }))
  )
    return;
  try {
    await mind.removeThought(t.id);
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <section class="notes-wall">
    <div class="wall-head">
      <div>
        <span class="eyebrow">THOUGHTS / 留给自己的话</span>
        <h2>有些念头，先放在心上。</h2>
        <p class="muted">
          TA 只在有新的理解时才写。放下的事会留着原因，想法也会随着经历改变。
        </p>
      </div>
      <form
        class="wall-search"
        role="search"
        @submit.prevent="emit('search', q)"
      >
        <input
          id="noteSearch"
          v-model="q"
          placeholder="搜索某件事、某个人"
          aria-label="搜索便签"
          @change="emit('search', q)"
        />
      </form>
    </div>
    <div v-if="thoughts.length" class="wall">
      <article
        v-for="t in thoughts"
        :key="t.id"
        class="note-card"
        :class="{ muted: t.hidden, resolved: t.status === 'resolved' }"
        :data-kind="t.kind"
      >
        <header>
          <b
            >{{ kinds[t.kind] || t.kind
            }}<template v-if="t.parent_id"> · 修正了以前的想法</template></b
          >
          <time>{{ when(t.created) }}</time>
        </header>
        <p>{{ t.content }}</p>
        <p v-if="t.status === 'resolved'" class="stamp">
          放下了{{ t.resolution ? `：${t.resolution}` : "" }}
        </p>
        <p v-if="t.outreach" class="outreach">
          想主动说：{{ t.outreach }} ·
          {{ OUTREACH_STATUS[t.outreach_status] || t.outreach_status }}
        </p>
        <footer>
          <button
            class="small"
            @click="
              update(t, { status: t.status === 'open' ? 'resolved' : 'open' })
            "
          >
            {{ t.status === "open" ? "放下这件事" : "重新关注" }}
          </button>
          <button class="small" @click="update(t, { hidden: !t.hidden })">
            {{ t.hidden ? "恢复" : "不再参与 TA 的思考" }}
          </button>
          <button class="text-button" @click="remove(t)">删除</button>
        </footer>
      </article>
    </div>
    <Empty
      v-else
      title="这面墙还空着"
      text="独处时有了新的理解、放不下的事或久别想起的人，TA 会写一张便签贴在这里。"
    />
  </section>
</template>

<style scoped>
.wall-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 16px;
}
.wall-head p {
  flex: 1 1 360px;
  font-size: 13px;
}
.wall-search {
  flex: 0 1 280px;
}
.wall {
  columns: 3 280px;
  column-gap: var(--gap);
}
.note-card {
  position: relative;
  display: grid;
  gap: 8px;
  margin: 0 0 var(--gap);
  padding: 20px 18px 14px;
  break-inside: avoid;
  border-radius: 6px 6px 18px 6px;
  background: color-mix(in srgb, var(--paper) 88%, var(--note, #fff3b0));
  box-shadow: var(--shadow-soft);
  transform: rotate(var(--tilt));
  transition:
    transform 0.35s var(--spring),
    box-shadow 0.3s;
}
.note-card:hover,
.note-card:focus-within {
  transform: rotate(0) translateY(-3px);
  box-shadow: var(--shadow);
}
.note-card[data-kind="unfinished"] {
  --note: #ffd6e8;
}
.note-card[data-kind="reflection"] {
  --note: #fff0b3;
}
.note-card[data-kind="revision"] {
  --note: #d8ecff;
}
.note-card[data-kind="reconnection"] {
  --note: #dcf5e6;
}
[data-mood="night"] .note-card {
  background: color-mix(in srgb, var(--paper) 80%, var(--note, #fff3b0) 20%);
}
.pin {
  position: absolute;
  top: -7px;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff, var(--accent) 60%);
  box-shadow: 0 3px 6px rgb(0 0 0 / 0.2);
  transform: translateX(-50%);
}
.note-card header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--ink-soft);
}
.note-card header b {
  color: var(--accent);
}
.note-card > p {
  font-size: 14.5px;
  line-height: 1.75;
}
.stamp {
  justify-self: start;
  padding: 2px 10px;
  border: 1.5px solid var(--ok);
  border-radius: 6px;
  color: var(--ok);
  font-size: 12px !important;
  font-weight: 700;
  transform: rotate(-2deg);
}
.outreach {
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  font-size: 12.5px !important;
}
.note-card footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--paper-line);
}
.note-card.muted {
  opacity: 0.62;
  background: transparent;
  border: 1.5px dashed var(--line);
  box-shadow: none;
}
.note-card.resolved > p:not(.stamp):not(.outreach) {
  color: var(--ink-soft);
}
.notes-wall {
  display: grid;
  gap: 20px;
}
.wall-head {
  margin: 0;
  align-items: end;
}
.wall-head > div {
  flex: 1 1 400px;
}
.wall-head h2 {
  margin: 5px 0 6px;
  font-size: clamp(20px, 2.3vw, 29px);
  letter-spacing: -0.03em;
}
.wall-head p {
  max-width: 60ch;
}
.wall-search input {
  border-radius: 999px;
  padding: 11px 17px;
  background: #ffffffa9;
  border-color: #fff;
  box-shadow:
    inset 0 1px 0 #fff,
    0 9px 25px -19px #6388ba;
}
.wall {
  column-gap: 17px;
}
.note-card,
[data-mood="night"] .note-card {
  isolation: isolate;
  margin-bottom: 17px;
  padding: 22px;
  border-radius: 27px 27px 28px 26px;
  border: 1px solid #ffffffe8;
  background: linear-gradient(
    140deg,
    #ffffffd4,
    #ffffff77 60%,
    color-mix(in srgb, var(--note, #d7e9ff) 45%, transparent)
  );
  box-shadow:
    inset 0 2px 0 #fff,
    0 18px 32px -28px #5b7faf;
  backdrop-filter: blur(22px) saturate(1.65);
  -webkit-backdrop-filter: blur(22px) saturate(1.65);
  transform: none;
  transition:
    transform 0.48s var(--spring),
    box-shadow 0.3s ease;
}
.note-card::before {
  content: "";
  position: absolute;
  z-index: -1;
  right: -37px;
  top: -40px;
  width: 118px;
  height: 118px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--note, #d7e9ff) 76%, #fff);
  filter: blur(18px);
  opacity: 0.65;
}
.note-card:hover,
.note-card:focus-within {
  transform: translateY(-5px) scale(1.012);
  box-shadow:
    inset 0 2px 0 #fff,
    0 28px 40px -27px #6885b5;
}
.note-card[data-kind="unfinished"] {
  --note: #f7cfe4;
}
.note-card[data-kind="reflection"] {
  --note: #ffe3c4;
}
.note-card[data-kind="revision"] {
  --note: #c8e6ff;
}
.note-card[data-kind="reconnection"] {
  --note: #cbf1df;
}
.note-card header {
  align-items: center;
  padding-bottom: 9px;
  border-bottom: 1px solid #ffffffb0;
}
.note-card header b {
  display: inline-flex;
  max-width: 100%;
  padding: 5px 10px;
  border-radius: 99px;
  background: #ffffff95;
  box-shadow: inset 0 1px 0 #fff;
  color: var(--accent);
}
.note-card > p {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.note-card footer {
  border-top: 1px solid #ffffffb3;
}
.note-card footer .small {
  border-radius: 99px;
  background: #ffffffac;
  border: 1px solid #fff;
}
.stamp {
  border: 1px solid color-mix(in srgb, var(--ok) 35%, #fff);
  background: #ffffff8c;
  border-radius: 99px;
  transform: none;
}
.outreach {
  border: 1px solid #fff;
  background: #ffffffa3;
}
.note-card.muted {
  opacity: 0.65;
  border: 1px solid #ffffffaa;
  background: #ffffff73;
  box-shadow: inset 0 1px 0 #fff;
}
</style>
