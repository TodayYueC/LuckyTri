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
            label: '相遇之间',
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
      <p class="muted">她记得相遇，也记得关系会随着时间改变。</p>
    </div>

    <template v-if="bonds">
      <template v-if="people.length">
        <Galaxy
          v-if="view === 'galaxy'"
          :people="people"
          :activity="presence.data?.activity?.kind"
          @open="open"
          @list="view = 'list'"
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
                <small class="qq">QQ {{ p.userId }}</small>
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
.people-bar {
  padding: 4px 2px 2px;
}
.people-bar p {
  max-width: 32ch;
}
.people-search {
  width: min(235px, 100%);
  border-radius: 99px;
  padding: 10px 15px;
  background: #ffffffad;
  border: 1px solid #fff;
  box-shadow:
    inset 0 1px 0 #fff,
    0 8px 22px -19px #5c81ae;
}
.people-list {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
  gap: 15px;
}
.person-card {
  isolation: isolate;
  overflow: hidden;
  padding: 20px;
  gap: 17px;
  border-radius: 27px;
  border-color: #ffffffe8;
  background: linear-gradient(
    135deg,
    #ffffffcf,
    #ffffff69 68%,
    hsl(var(--hue) 80% 91% / 0.42)
  );
  box-shadow:
    inset 0 2px 0 #fff,
    0 18px 30px -25px #6a88b5;
  transition:
    transform 0.45s var(--spring),
    box-shadow 0.26s ease;
}
.person-card::before {
  content: "";
  position: absolute;
  z-index: -1;
  top: -60px;
  right: -70px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: hsl(var(--hue) 80% 86% / 0.4);
  filter: blur(25px);
}
.person-card:hover:not(:disabled) {
  transform: translateY(-5px) scale(1.018);
  box-shadow:
    inset 0 2px 0 #fff,
    0 28px 35px -23px #6386b5;
}
.person-card:active:not(:disabled) {
  transform: scale(0.975);
}
.person-card header {
  padding-bottom: 12px;
  border-bottom: 1px solid #ffffffc4;
}
.person-card .avatar {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: radial-gradient(
    circle at 26% 20%,
    #fff,
    hsl(var(--hue) 78% 86%) 53%,
    hsl(var(--hue) 69% 76%)
  );
  box-shadow:
    inset 3px 3px 5px #fff,
    0 8px 14px -9px #5b7fae;
  transition: transform 0.45s var(--spring);
}
.person-card:hover .avatar {
  transform: rotate(-8deg) scale(1.1);
}
.person-card .stack.tight {
  padding: 5px 0;
}
@media (max-width: 760px) {
  .people-bar p {
    flex-basis: 100%;
  }
}
</style>
