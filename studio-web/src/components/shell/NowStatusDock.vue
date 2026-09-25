<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "../../api";
import { presence, refreshPresence } from "../../stores/presence";
import { studio } from "../../stores/studio";
import { activityLine, latelyLine, statusLine } from "../../mood/presence";
import { mind } from "../../plates/mind";
import { ago, placeName } from "../../format";

const overview = ref<any>(null);
const running = ref(false);
const p = computed(() => presence.data);
const affect = computed(() => p.value?.affect || overview.value?.affect || {});
const activity = computed(() => p.value?.activity?.kind || "idle");
const nextExpect = computed(() => p.value?.expecting?.[0] || null);
const busyMind = computed(
  () =>
    running.value ||
    Boolean(overview.value?.busy) ||
    ["solitude", "diary", "review", "night"].includes(activity.value),
);

async function load() {
  try {
    overview.value = await mind.overview();
  } catch {
    // The shared presence store remains available while the overview refreshes.
  }
}

async function run(kind: "reflect" | "review") {
  running.value = true;
  try {
    const result = await mind[kind]();
    toast(result.reason || "完成了", result.status === "error");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    running.value = false;
    await Promise.all([load(), refreshPresence()]);
  }
}

onMounted(() => void load());
watch(() => [studio.tick, studio.pulse], () => void load());
</script>

<template>
  <aside class="presence-dock" aria-label="TA 的此刻状态">
    <div class="presence-detail">
      <span class="eyebrow">
        第 {{ p?.dayOfLife ?? overview?.dayOfLife ?? 1 }} 天
        <template v-if="p?.clock">
          · {{ p.clock.period }} {{ p.clock.local.slice(11) }}
        </template>
      </span>
      <h2 class="mood-word">{{ affect.mood || "平静" }}</h2>
      <p class="lede">
        {{ statusLine(affect) || "没有特别牵动 TA 的事，心情慢慢回到平常。" }}
      </p>
      <div class="row chips">
        <span class="chip activity-chip" :data-activity="activity">
          {{ activityLine(p) }}
        </span>
        <span v-if="latelyLine(affect)" class="chip" data-tone="quiet">
          这阵子 · {{ latelyLine(affect) }}
        </span>
        <span v-if="affect.energyLabel" class="chip" data-tone="quiet">
          精力 · {{ affect.energyLabel }}
        </span>
        <span v-if="overview?.nature?.rhythm?.enabled" class="chip" data-tone="quiet">
          {{ overview.nature.rhythm.wake }} 醒 / {{ overview.nature.rhythm.sleep }} 睡
        </span>
      </div>
      <div class="row actions">
        <button class="primary" @click="studio.chatOpen = true">和 TA 聊聊</button>
        <button :disabled="busyMind" @click="run('reflect')">
          {{ busyMind ? "TA 正在想…" : "让 TA 独处一会儿" }}
        </button>
        <button :disabled="busyMind" @click="run('review')">写下今天的日记</button>
      </div>
      <small class="faint">{{ overview?.reason || "安静下来时，TA 会自己独处。" }}</small>
      <div v-if="p?.lastWords" class="aside-bit">
        <span class="eyebrow">最近说</span>
        <p>“{{ p.lastWords.text }}”</p>
        <small>{{ placeName({ name: p.lastWords.sessionName, id: p.lastWords.session }) }} · {{ ago(p.lastWords.time, p.now) }}</small>
      </div>
      <div v-if="p?.thought" class="aside-bit">
        <span class="eyebrow">放在心上</span>
        <p>{{ p.thought.content }}</p>
        <small v-if="p.thought.when">{{ p.thought.when }}</small>
      </div>
      <div v-if="nextExpect" class="aside-bit">
        <span class="eyebrow">在等</span>
        <p>{{ nextExpect.name ? `${nextExpect.name}：` : "" }}{{ nextExpect.content }}</p>
        <small v-if="nextExpect.when">{{ nextExpect.when }}</small>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.presence-dock {
  position: sticky;
  z-index: 4;
  top: 96px;
  display: grid;
  align-content: start;
  gap: 12px;
  align-self: start;
  width: 100%;
  height: calc(100dvh - 112px);
  max-height: calc(100dvh - 112px);
  overflow: auto;
  padding: 22px;
  border: 1px solid rgb(255 255 255 / 0.88);
  border-radius: 28px;
  background: linear-gradient(
    145deg,
    rgb(255 255 255 / 0.92),
    rgb(248 251 255 / 0.88)
  );
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.96),
    0 24px 48px -34px rgb(39 69 128 / 0.56);
  color: var(--ink);
}
.presence-detail {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
}
.mood-word {
  font-family: var(--font-display);
  font-size: clamp(48px, 3.5vw, 70px);
  font-weight: 750;
  letter-spacing: -0.055em;
  background: linear-gradient(105deg, var(--ink) 4%, #83bcf2 52%, #dd9dca 95%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}
.chips {
  gap: 7px;
}
.chips .chip {
  background: rgb(255 255 255 / 0.64);
  border-color: rgb(255 255 255 / 0.84);
}
.actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
.actions > button {
  width: 100%;
  justify-content: center;
  background: rgb(255 255 255 / 0.54);
  border-color: rgb(255 255 255 / 0.88);
}
.actions > button.primary {
  background: linear-gradient(120deg, #84bdfb, #a5b5f0 56%, #dfb4e5);
  color: #213e73;
  box-shadow: 0 16px 32px -16px #7ca9ef;
}
.aside-bit {
  display: grid;
  gap: 4px;
  padding-top: 10px;
  border-top: 1px solid rgb(255 255 255 / 0.7);
}
.aside-bit p {
  font-size: 13.5px;
  line-height: 1.55;
}
.aside-bit small {
  color: var(--ink-soft);
  font-size: 12px;
}
@media (max-width: 760px) {
  .presence-dock {
    position: relative;
    top: auto;
    width: calc(100% - 28px);
    height: auto;
    max-height: none;
    margin: 0 auto 8px;
  }
}
</style>
