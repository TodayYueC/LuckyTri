<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { setSub, studio } from "../../stores/studio";
import { presence } from "../../stores/presence";
import { DIMENSIONS, mind } from "../../plates/mind";
import { ago, hueOf, initials } from "../../format";
import Tabs from "../../components/ui/Tabs.vue";
import Meter from "../../components/ui/Meter.vue";
import Empty from "../../components/ui/Empty.vue";
import Galaxy from "./Galaxy.vue";
import PersonSheet from "./PersonSheet.vue";
import GroupFaces from "./GroupFaces.vue";

const bonds = ref<any>(null);
const view = ref("galaxy");
const query = ref("");
const personId = ref<string | null>(
  studio.sub && studio.sub !== "list" ? studio.sub : null,
);
if (studio.sub === "list") view.value = "list";

const people = computed(() => {
  const q = query.value.trim();
  const list = bonds.value?.people || [];
  return q
    ? list.filter((p: any) =>
        `${p.name}${p.userId}${p.impression || ""}`.includes(q),
      )
    : list;
});

async function load() {
  bonds.value = await mind.bonds();
}

function open(id: string) {
  personId.value = id;
  setSub(id);
}

function close() {
  personId.value = null;
  setSub(view.value === "list" ? "list" : "");
}

watch(view, (next) => {
  if (!personId.value) setSub(next === "list" ? "list" : "");
});
watch(
  () => studio.sub,
  (sub) => {
    if (sub === "list") view.value = "list";
    personId.value = sub && sub !== "list" ? sub : null;
  },
);
watch(() => studio.tick, load);
onMounted(load);
</script>

<template>
  <div class="page people">
    <div class="people-bar">
      <Tabs
        v-model="view"
        label="人际的视图"
        :items="[
          {
            key: 'galaxy',
            label: '人物星系',
            count: bonds?.people.length ?? '',
          },
          { key: 'list', label: '列表' },
        ]"
      />
      <input
        v-model="query"
        class="people-search"
        type="search"
        placeholder="找一个人"
        aria-label="找一个人"
      />
      <p class="muted">
        同一个人，在哪里都是同一个人。TA 对每个人的感觉都从一起经历的事里来。
      </p>
    </div>

    <template v-if="bonds">
      <template v-if="people.length">
        <Galaxy
          v-if="view === 'galaxy'"
          :people="people"
          :activity="presence.data?.activity?.kind"
          @open="open"
        />
        <div v-else class="people-list">
          <button
            v-for="p in people"
            :key="p.userId"
            class="card person-card"
            :data-person="p.userId"
            @click="open(p.userId)"
          >
            <header>
              <span
                class="avatar"
                :style="{ '--hue': hueOf(p.name || p.userId) }"
                >{{ initials(p.name) }}</span
              >
              <div>
                <h3>{{ p.name }}</h3>
                <small class="muted">{{ p.feel }}</small>
              </div>
            </header>
            <div class="stack tight">
              <Meter
                v-for="[key, label] in DIMENSIONS"
                :key="key"
                :label="label"
                :value="p[key]"
                :warn="key === 'tension'"
              />
            </div>
            <small class="faint">
              在 {{ p.sessions.length }} 个地方见过 · 上次说上话
              {{
                p.lastTalkedAt
                  ? ago(p.lastTalkedAt, presence.data?.now)
                  : "还没有"
              }}
            </small>
          </button>
        </div>
      </template>
      <Empty
        v-else
        title="TA 还没有认识谁"
        text="有人和 TA 说话、TA 细看过群聊之后，这里会出现 TA 对每个人的感觉。"
      />

      <GroupFaces :groups="bonds.groups" @changed="load" />
    </template>

    <PersonSheet
      :id="personId"
      :now="presence.data?.now"
      @close="close"
      @changed="load"
    />
  </div>
</template>

<style scoped>
.people {
  display: grid;
  gap: var(--gap);
}
.people-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.people-search {
  width: 200px;
  border-radius: 999px;
}
.people-bar p {
  flex: 1 1 300px;
  font-size: 13px;
}
.people-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--gap);
}
.person-card {
  display: grid;
  gap: 14px;
  text-align: left;
  font-weight: 500;
  border-radius: var(--r-l);
}
.person-card header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.person-card h3 {
  font-size: 16px;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 30%,
    hsl(var(--hue) 90% 92%),
    hsl(var(--hue) 65% 72%)
  );
  color: hsl(var(--hue) 45% 22%);
  font: 700 15px var(--font-display);
}
</style>
