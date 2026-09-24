<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { toast } from "../api";
import { mind, percent } from "../plates/mind";
import Now from "./her/Now.vue";
import SelfView from "./her/Self.vue";
import Bonds from "./her/Bonds.vue";
import Life from "./her/Life.vue";
import Nature from "./her/Nature.vue";

const views = [
  { id: "now", label: "此刻", en: "NOW" },
  { id: "self", label: "自我", en: "SELF" },
  { id: "bonds", label: "关系", en: "BONDS" },
  { id: "life", label: "一生", en: "LIFE" },
  { id: "nature", label: "天性", en: "NATURE" },
] as const;
type View = (typeof views)[number]["id"];
const initial = sessionStorage.herView as View;
const view = ref<View>(views.some((v) => v.id === initial) ? initial : "now");
const data = ref<any>(null);
let timer: ReturnType<typeof setInterval>;

async function load() {
  try {
    data.value = await mind.overview();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
function open(next: View) {
  view.value = next;
  sessionStorage.herView = next;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
onMounted(() => {
  load();
  timer = setInterval(load, 10000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div v-if="data" class="her-studio">
    <header class="her-masthead surface">
      <div class="her-art" :data-phase="data.affect.phase" aria-hidden="true">
        <span>{{ data.clock.hour }}</span
        ><small>时</small>
      </div>
      <div class="her-intro">
        <span class="eyebrow">ONE OF HER / {{ data.nature.name }}</span>
        <h2>
          {{ data.affect.phaseLabel }}，<em>{{ data.affect.mood }}</em>
        </h2>
        <p>
          {{ data.clock.local }} · 精力{{ data.affect.energyLabel }}
          <template v-if="data.affect.cause">
            · 因为{{ data.affect.cause }}</template
          >
        </p>
      </div>
      <div class="her-control">
        <div class="meter-row">
          <span>精力</span>
          <div class="meter">
            <i :style="{ width: percent(data.affect.energy) }"></i>
          </div>
          <em>{{ percent(data.affect.energy) }}</em>
        </div>
        <div class="meter-row">
          <span>心情</span>
          <div class="meter" :class="{ warn: data.affect.valence < 0 }">
            <i :style="{ width: percent((data.affect.valence + 1) / 2) }"></i>
          </div>
          <em
            >{{ data.affect.valence >= 0 ? "+" : ""
            }}{{ data.affect.valence }}</em
          >
        </div>
        <div class="meter-row">
          <span>今日 Token</span>
          <div
            class="meter"
            :class="{ warn: data.budget.pressure.conversation >= 0.7 }"
          >
            <i
              :style="{
                width: data.budget.limits.total
                  ? percent(data.budget.pressure.conversation)
                  : '0%',
              }"
            ></i>
          </div>
          <em>{{
            data.budget.limits.total
              ? percent(data.budget.pressure.conversation)
              : "不限"
          }}</em>
        </div>
      </div>
    </header>
    <nav class="her-nav surface" aria-label="她的分区">
      <button
        v-for="item in views"
        :key="item.id"
        type="button"
        :data-her="item.id"
        :class="{ active: view === item.id }"
        :aria-current="view === item.id ? 'page' : undefined"
        @click="open(item.id)"
      >
        <small>{{ item.en }}</small
        ><b>{{ item.label }}</b
        ><span>↗</span>
      </button>
    </nav>
    <Now v-if="view === 'now'" :data="data" @changed="load" />
    <SelfView v-else-if="view === 'self'" :data="data" @changed="load" />
    <Bonds v-else-if="view === 'bonds'" :data="data" @changed="load" />
    <Life v-else-if="view === 'life'" :data="data" @changed="load" />
    <Nature v-else :data="data" @changed="load" />
  </div>
  <div v-else class="empty-state" role="status">正在走近她…</div>
</template>
