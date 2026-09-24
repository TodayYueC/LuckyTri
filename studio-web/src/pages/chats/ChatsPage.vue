<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { toast } from "../../api";
import { ask } from "../../dialog";
import { reload, setSub, studio } from "../../stores/studio";
import { mind } from "../../plates/mind";
import {
  listEvents,
  listTraces,
  sendFeedback,
  simulateTurn,
} from "../../plates/live";
import {
  addSession,
  archiveSession,
  clearSessionContext,
  deleteSession,
  listSummaries,
  saveSession,
  setSessionEnabled,
} from "../../plates/sessions";
import { fetchState } from "../../plates/workspace";
import { subscribe } from "../../sse";
import { useMedia } from "../../media";
import Sheet from "../../components/ui/Sheet.vue";
import SessionList from "./SessionList.vue";
import AddSession from "./AddSession.vue";
import Transcript from "./Transcript.vue";
import SessionPanel from "./SessionPanel.vue";
import ReplaySheet from "./ReplaySheet.vue";

const compact = useMedia("(max-width: 1100px)");
const sessions = computed(() => studio.core?.sessions || []);
const active = computed(() => sessions.value.filter((s: any) => !s.archived));
const initial = sessionStorage.activeSession;
const sessionId = ref(
  active.value.some((s: any) => s.id === initial)
    ? initial
    : active.value[0]?.id || "",
);
const session = computed(
  () => active.value.find((s: any) => s.id === sessionId.value) || null,
);
const events = ref<any[]>([]);
const traces = ref<any[]>([]);
const summaries = ref<any[]>([]);
const groups = ref<any[]>([]);
const unread = ref<Record<string, number>>({});
const status = ref("请选择会话");
const sending = ref(false);
const adding = ref(false);
const listOpen = ref(false);
const settingsOpen = ref(studio.sub === "settings");
const replayOpen = ref(studio.sub === "replay");
const panelTab = ref("here");
const decisions = computed(() => studio.health?.decisions || []);
const group = computed(
  () => groups.value.find((g) => g.session === sessionId.value) || null,
);

let busy = false;
let loadAgain = false;
let forceReload = false;
let loadedSession = "";
let loadedSeq = 0;
let streamAbort: AbortController | null = null;
let timer = 0;

async function load(force = false) {
  if (!sessionId.value) return;
  if (busy) {
    loadAgain = true;
    forceReload ||= force;
    return;
  }
  const requested = sessionId.value;
  const full = force || loadedSession !== requested;
  busy = true;
  try {
    const [rows, list] = await Promise.all([
      listEvents(requested, full ? undefined : loadedSeq),
      listTraces(requested, { limit: 30, compact: true }),
    ]);
    if (sessionId.value !== requested) return;
    const pane = document.getElementById("liveMessages");
    const follow =
      loadedSession !== requested ||
      !pane ||
      pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
    if (full) {
      events.value = rows.reverse();
      loadedSeq = 0;
    } else if (rows.length) events.value = [...events.value, ...rows];
    for (const row of rows)
      loadedSeq = Math.max(loadedSeq, Number(row.seq) || 0);
    if (!full && rows.length === 100) loadAgain = true;
    traces.value = list;
    loadedSession = requested;
    await nextTick();
    const fresh = document.getElementById("liveMessages");
    if (fresh && follow) fresh.scrollTop = fresh.scrollHeight;
    status.value = "实时同步 · " + new Date().toLocaleTimeString();
  } catch (error) {
    status.value = "同步失败：" + (error as Error).message;
  } finally {
    busy = false;
    if (sessionId.value !== requested) {
      loadAgain = false;
      void load();
    } else if (loadAgain) {
      const everything = forceReload;
      loadAgain = false;
      forceReload = false;
      void load(everything);
    }
  }
}

async function loadMind() {
  try {
    const [bonds, overview] = await Promise.all([
      mind.bonds(),
      mind.overview(),
    ]);
    groups.value = bonds.groups;
    unread.value = Object.fromEntries(
      overview.attention.map((a: any) => [a.session, a.unread]),
    );
  } catch {
    // The chat still works without TA's side notes.
  }
}

watch(
  sessionId,
  (id) => {
    streamAbort?.abort();
    if (id) sessionStorage.activeSession = id;
    events.value = [];
    traces.value = [];
    summaries.value = [];
    loadedSession = "";
    loadedSeq = 0;
    loadAgain = false;
    forceReload = false;
    listOpen.value = false;
    void load();
    if (!id) return;
    listSummaries(id)
      .then((rows) => {
        if (sessionId.value === id) summaries.value = [...rows].reverse();
      })
      .catch(() => {});
    const controller = new AbortController();
    streamAbort = controller;
    let previous = "";
    void subscribe(
      (value) => {
        const messages = Number((value as { messages?: unknown })?.messages);
        if (Number.isSafeInteger(messages) && messages < loadedSeq) {
          loadedSession = "";
          loadedSeq = 0;
          events.value = [];
        }
        const next = JSON.stringify(value);
        const changed = previous !== "" && next !== previous;
        previous = next;
        if (changed) void load();
      },
      { session: id, signal: controller.signal, reconnectMs: 1000 },
    );
  },
  { immediate: true },
);

watch(active, (list) => {
  if (!list.some((s: any) => s.id === sessionId.value))
    sessionId.value = list[0]?.id || "";
});

watch(panelTab, async (tab) => {
  if (tab !== "feedback") return;
  try {
    studio.health = await fetchState();
  } catch {
    // Keep the last loaded feedback list.
  }
});

watch(replayOpen, (open) =>
  setSub(open ? "replay" : settingsOpen.value ? "settings" : ""),
);
watch(
  () => studio.sub,
  (sub) => {
    if (sub === "replay") replayOpen.value = true;
    if (sub === "settings") settingsOpen.value = true;
  },
);
watch(() => studio.pulse, loadMind);

onMounted(() => {
  loadMind();
  // A slow safety refresh for dropped events; normal updates use SSE.
  timer = window.setInterval(() => load(true), 15000);
});
onUnmounted(() => {
  clearInterval(timer);
  streamAbort?.abort();
});

async function add(data: Record<string, string>) {
  try {
    await addSession(data);
    await reload();
    sessionId.value = `${data.kind}:${data.id}`;
    settingsOpen.value = true;
    panelTab.value = "here";
    adding.value = false;
    toast("会话已添加");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function toggle(s: any) {
  await setSessionEnabled(s.id, !s.enabled);
  await reload();
}

async function archive(id: string) {
  await archiveSession(id, true);
  await reload();
}

async function restore(id: string) {
  await archiveSession(id, false);
  await reload();
}

async function remove(id: string) {
  if (
    !(await ask("永久删除这个会话？它的消息和设置都会消失。", {
      title: "永久删除",
      confirmText: "删除",
      danger: true,
    }))
  )
    return;
  await deleteSession(id);
  await reload();
}

async function save(policy: Record<string, unknown>) {
  if (!session.value) return;
  try {
    await saveSession(session.value.id, {
      ...policy,
      name: session.value.name,
    });
    studio.dirty = false;
    toast("会话配置已保存");
    await reload();
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function clear() {
  if (!sessionId.value) return;
  if (
    !(await ask("确定清空这个会话的消息上下文吗？长期记忆不会删除。", {
      title: "清空上下文",
      confirmText: "清空",
      danger: true,
    }))
  )
    return;
  await clearSessionContext(sessionId.value);
  events.value = [];
  traces.value = [];
  loadedSession = "";
  loadedSeq = 0;
  await load(true);
}

async function simulate(body: {
  userId: string;
  text: string;
  mentioned: boolean;
}) {
  if (sending.value || !sessionId.value) return;
  sending.value = true;
  try {
    const r = await simulateTurn({ sessionId: sessionId.value, ...body });
    toast(r.reason || "已发送");
    studio.health = await fetchState();
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    sending.value = false;
  }
}

async function feedback(id: number, tag: string) {
  try {
    await sendFeedback(id, tag);
    toast("反馈已保存");
    studio.health = await fetchState();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
</script>

<template>
  <div class="page chats" :class="{ compact }">
    <aside v-if="!compact" class="card col list-col">
      <SessionList
        :sessions="sessions"
        :selected="sessionId"
        :unread="unread"
        @select="sessionId = $event"
        @add="adding = true"
        @toggle="toggle"
        @restore="restore"
        @remove="remove"
      />
    </aside>
    <div class="card col talk-col">
      <Transcript
        v-model:session-id="sessionId"
        :session="session"
        :sessions="active"
        :events="events"
        :traces="traces"
        :decisions="decisions"
        :status="status"
        :demo="Boolean(studio.health.settings.demo)"
        :compact="compact"
        :sending="sending"
        @simulate="simulate"
        @feedback="feedback"
        @open-list="listOpen = true"
        @open-replay="replayOpen = true"
      />
    </div>
    <aside class="card col panel-col">
      <SessionPanel
        v-model:settings-open="settingsOpen"
        v-model:tab="panelTab"
        :session="session"
        :group="group"
        :summaries="summaries"
        :decisions="decisions"
        @toggle="toggle"
        @archive="archive"
        @clear="clear"
        @save="save"
        @feedback="feedback"
      />
    </aside>

    <Sheet
      v-if="compact"
      :open="listOpen"
      title="全部会话"
      eyebrow="CHATS"
      width="400px"
      @close="listOpen = false"
    >
      <div class="sheet-list">
        <SessionList
          :sessions="sessions"
          :selected="sessionId"
          :unread="unread"
          @select="sessionId = $event"
          @add="adding = true"
          @toggle="toggle"
          @restore="restore"
          @remove="remove"
        />
      </div>
    </Sheet>
    <AddSession :open="adding" @close="adding = false" @add="add" />
    <ReplaySheet
      :open="replayOpen"
      :session-id="sessionId"
      :events="events"
      @close="replayOpen = false"
      @load="load(true)"
    />
  </div>
</template>

<style scoped>
.chats {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 340px;
  gap: 16px;
  width: min(1520px, 100%);
  height: 100%;
  min-height: 0;
  padding-bottom: 0;
}
.chats.compact {
  grid-template-columns: minmax(0, 1fr) 320px;
}
.col {
  min-height: 0;
  height: 100%;
  padding: 16px;
}
.talk-col {
  padding: 16px 18px 14px;
}
.sheet-list {
  height: calc(100dvh - 120px);
}
@media (max-width: 760px) {
  .chats,
  .chats.compact {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: auto;
  }
  .talk-col {
    height: 500px;
  }
  .panel-col {
    height: 620px;
  }
}
</style>
