<script setup lang="ts">
import { intlLocale, t, N_ } from "../../i18n";
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

const compact = useMedia("(max-width: 900px)");
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
const status = ref("");
const sending = ref(false);
const adding = ref(false);
const listOpen = ref(false);
const settingsOpen = ref(studio.sub === "settings");
const detailsOpen = ref(studio.sub === "settings");
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
    status.value =
      t("实时同步 · ") + new Date().toLocaleTimeString(intlLocale());
  } catch (error) {
    status.value = t("同步失败：") + (error as Error).message;
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

watch(replayOpen, (open) => {
  if (open) setSub("replay");
  else if (studio.sub === "replay") setSub("");
});
watch(detailsOpen, (open) => {
  if (open) setSub("settings");
  else if (studio.sub === "settings") setSub("");
});
watch(
  () => studio.sub,
  (sub) => {
    replayOpen.value = sub === "replay";
    detailsOpen.value = sub === "settings";
    if (sub === "settings") settingsOpen.value = true;
  },
);
async function closeDetails() {
  if (
    studio.dirty &&
    !(await ask(t("当前设置还没保存，离开这个分区吗？"), {
      title: t("未保存的修改"),
      confirmText: t("放弃修改"),
      cancelText: t("继续编辑"),
    }))
  )
    return;
  studio.dirty = false;
  detailsOpen.value = false;
}
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
    const added = await addSession(data);
    await reload();
    sessionId.value = added?.sessionId || `${data.kind}:${data.id}`;
    settingsOpen.value = true;
    panelTab.value = "here";
    adding.value = false;
    listOpen.value = false;
    detailsOpen.value = true;
    toast(t("会话已添加"));
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
    !(await ask(t("永久删除这个会话？它的消息和设置都会消失。"), {
      title: t("永久删除"),
      confirmText: t("删除"),
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
      name: String(policy.name || "").trim() || session.value.name,
    });
    studio.dirty = false;
    toast(t("会话配置已保存"));
    await reload();
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function clear() {
  if (!sessionId.value) return;
  if (
    !(await ask(t("确定清空这个会话的消息上下文吗？长期记忆不会删除。"), {
      title: t("清空上下文"),
      confirmText: t("清空"),
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
    toast(r.reason || t("已发送"));
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
    toast(t("反馈已保存"));
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
        :session-id="sessionId"
        :session="session"
        :events="events"
        :traces="traces"
        :decisions="decisions"
        :status="status || t('请选择会话')"
        :demo="Boolean(studio.health.settings.demo)"
        :compact="compact"
        :sending="sending"
        @simulate="simulate"
        @feedback="feedback"
        @open-list="listOpen = true"
        @open-replay="replayOpen = true"
        @open-details="detailsOpen = true"
      />
    </div>
    <Sheet
      :open="detailsOpen"
      :title="t('会话详情与反馈')"
      width="480px"
      @close="closeDetails"
    >
      <div class="panel-col">
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
      </div>
    </Sheet>

    <Sheet
      v-if="compact"
      :open="listOpen"
      :title="t('全部会话')"
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
    <AddSession
      :open="adding"
      :channel="
        studio.health?.connection?.channel === 'qqbot' ? 'qqbot' : 'onebot'
      "
      :ready="Boolean(studio.health?.connection?.qqbot?.appId)"
      @close="adding = false"
      @add="add"
    />
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
.conversation-tools {
  display: flex;
  justify-content: flex-end;
  flex: none;
  padding-bottom: 10px;
}
.conversation-tools button {
  font-size: 12px;
  padding: 7px 11px;
}
.panel-col {
  min-height: 0;
}

@layer components {
  .chats {
    position: relative;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 18px;
    width: min(1520px, 100%);
    height: 100%;
    min-height: 0;
    padding-bottom: 0;
  }
  .chats.compact {
    grid-template-columns: minmax(0, 1fr);
  }
  .col {
    position: relative;
    min-height: 0;
    height: 100%;
    padding: 18px;
    overflow: hidden;
    border-radius: 30px;
    background: var(--surface);
    box-shadow: none;
  }
  .talk-col {
    padding: 18px 20px 16px;
    background:
      radial-gradient(
        ellipse at 80% 0,
        color-mix(in srgb, var(--glow-b) 25%, transparent),
        transparent 55%
      ),
      linear-gradient(
        145deg,
        rgb(255 255 255 / 0.78),
        rgb(255 255 255 / 0.4) 64%
      ),
      var(--surface);
  }
  .list-col,
  .panel-col {
    background:
      radial-gradient(
        circle at 0 0,
        color-mix(in srgb, var(--glow-a) 18%, transparent),
        transparent 42%
      ),
      linear-gradient(165deg, rgb(255 255 255 / 0.75), rgb(255 255 255 / 0.28)),
      var(--surface);
  }
  .sheet-list {
    height: calc(100dvh - 120px);
  }
  @media (max-width: 900px) {
    .chats,
    .chats.compact {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      height: auto;
    }
    .talk-col {
      height: clamp(420px, 68dvh, 620px);
    }
  }
}
</style>
