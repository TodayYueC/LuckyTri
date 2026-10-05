<script setup lang="ts">
import { t, N_, localized } from "../../i18n";
import Sheet from "../../components/ui/Sheet.vue";
import { ref, watch } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { mind, when } from "../../plates/mind";
import { hueOf, placeName } from "../../format";

const props = defineProps<{ groups: any[] }>();
const emit = defineEmits<{ changed: [] }>();
const selected = ref<any>(null);
const history = ref<Record<string, any[]>>({});
const kinds: Record<string, string> = localized({
  impression: N_("印象"),
  wish: N_("想做的事"),
  preference: N_("偏好"),
  question: N_("还在想的问题"),
  boundary: N_("相处的分寸"),
});
const actions: Record<string, string> = localized({
  add: N_("新增"),
  revise: N_("修改"),
  remove: N_("放下"),
});
watch(
  () => props.groups,
  (groups) => {
    if (selected.value)
      selected.value =
        groups.find((g) => g.session === selected.value.session) || null;
  },
);

async function toggle(session: string) {
  if (
    history.value[session] &&
    history.value[session]?.[0]?.id ===
      props.groups.find((g) => g.session === session)?.face?.id
  ) {
    return;
  }
  try {
    history.value = { ...history.value, [session]: await mind.faces(session) };
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function revoke(session: string, id: string) {
  if (
    !(await ask(t("撤销这次想法更新？会恢复上一次保留的想法。"), {
      title: t("撤销想法更新"),
      confirmText: t("撤销"),
      danger: true,
    }))
  )
    return;
  try {
    await mind.revoke("face", id);
    history.value = { ...history.value, [session]: await mind.faces(session) };
    toast(t("已撤销"));
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <section class="faces">
    <div class="faces-head">
      <span class="eyebrow">{{ t("在这里的想法") }}</span>
      <h2>{{ t("同一个她，在不同的地方留下自己的想法。") }}</h2>
      <p class="muted">
        {{
          t(
            "她根据相处留下印象、愿望或疑问，选择什么时候新增、修改或放下。每次更新保留理由和来源。",
          )
        }}
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
          <span class="badge">{{
            g.kind === "private" ? t("私") : t("群")
          }}</span>
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
              >{{ g.kind === "private" ? t("私聊") : t("群聊")
              }}{{ g.bond ? ` · ${g.bond.feel}` : "" }}</small
            >
          </div>
        </header>
        <ul v-if="g.face?.notes?.length" class="place-notes compact">
          <li v-for="note in g.face.notes.slice(0, 3)" :key="note.id">
            <small>{{ kinds[note.kind] || t("想法") }}</small>
            <p class="face-excerpt">{{ note.content }}</p>
          </li>
        </ul>
        <p v-else class="muted small-text">
          {{ t("还没有特别想留在这里的想法，之后由她自己选择。") }}
        </p>
        <button
          class="text-button"
          @click="
            selected = g;
            toggle(g.session);
          "
        >
          {{ t("查看想法与变化 ↗") }}
        </button>
      </article>
    </div>
    <Sheet
      :open="!!selected"
      :title="selected?.name || t('在这里的想法')"
      :eyebrow="t('PLACE NOTES / 在这里的想法')"
      width="680px"
      @close="selected = null"
      ><div v-if="selected" class="stack">
        <ul v-if="selected.face?.notes?.length" class="place-notes">
          <li
            v-for="note in selected.face.notes"
            :key="note.id"
            class="face-full"
          >
            <small>{{ kinds[note.kind] || t("想法") }}</small>
            <p>{{ note.content }}</p>
            <p v-if="note.why" class="muted small-text">{{ note.why }}</p>
            <small class="faint">{{
              t("{n} 处来源", { n: note.sources?.length || 0 })
            }}</small>
          </li>
        </ul>
        <p v-else class="muted">
          {{ t("还没有特别想留在这里的想法，之后由她自己选择。") }}
        </p>
        <h3>{{ t("变化历史") }}</h3>
        <ol v-if="history[selected.session]" class="versions">
          <li
            v-for="f in history[selected.session]"
            :key="f.id"
            :class="{ revoked: f.revoked }"
          >
            <time>{{ when(f.created) }}</time>
            <span>
              <b v-if="f.revoked">{{ t("已撤销 ·") }} </b
              ><b v-else-if="f.origin === 'migration'">{{ t("旧版 ·") }} </b>
              <template v-if="f.changes?.length">
                <p v-for="(change, i) in f.changes" :key="i">
                  <b>{{ actions[change.action] }} · </b>{{ change.content }}
                  <small v-if="change.why" class="change-why">{{
                    change.why
                  }}</small>
                </p>
              </template>
              <template v-else-if="f.notes?.length">{{
                f.notes.map((n: any) => n.content).join("；")
              }}</template>
              <details v-else class="legacy-face">
                <summary>{{ t("旧人格记录，仅保留历史") }}</summary>
                <p class="face-full">
                  {{
                    f.content ||
                    [f.role, f.tone, f.aspiration].filter(Boolean).join("；")
                  }}
                </p>
              </details>
            </span>
            <button
              v-if="!f.revoked"
              class="text-button"
              @click="revoke(selected.session, f.id)"
            >
              {{ t("撤销") }}
            </button>
          </li>
          <li v-if="!history[selected.session].length" class="muted">
            {{ t("没有记录。") }}
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
.place-notes {
  display: grid;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.place-notes small {
  color: var(--ink-soft);
}
.place-notes p {
  margin: 3px 0;
  overflow-wrap: anywhere;
}
.compact {
  gap: 9px;
}
.change-why {
  display: block;
  margin-top: 4px;
  color: var(--ink-soft);
}
.legacy-face {
  overflow-wrap: anywhere;
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
