<script setup lang="ts">
import { onMounted, ref } from "vue";
import { toast } from "../../api";
import { ORIGIN_LABELS, mind, percent, when } from "../../plates/mind";

function knownFor(p: any) {
  if (!p.firstMetAt) return "";
  const days = Math.max(1, Math.round((Date.now() - p.firstMetAt) / 86400000));
  return `认识 ${days} 天`;
}

defineProps<{ data: any }>();
const emit = defineEmits<{ changed: [] }>();
const bonds = ref<any>(null);
const person = ref<any>(null);
const changes = ref<any[]>([]);
const faceHistory = ref<Record<string, any[]>>({});
const CHANGE: Record<string, string> = {
  warmer: "更亲近了一点",
  closer: "走近了",
  trust_up: "更信任了",
  trust_down: "有点失望",
  friction: "有了别扭",
  repair: "和好了",
  distance: "疏远了一点",
  impression: "印象",
};
const DIMENSIONS = [
  ["familiarity", "熟悉"],
  ["closeness", "亲近"],
  ["trust", "信任"],
  ["tension", "别扭"],
] as const;

async function load() {
  try {
    bonds.value = await mind.bonds();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function choose(p: any) {
  person.value = p;
  changes.value = await mind.bondChanges("person", p.userId);
}
async function revokeChange(c: any) {
  if (
    !confirm(
      `撤销这次「${CHANGE[c.change] || c.change}」？她对这个人的感觉会重新计算。`,
    )
  )
    return;
  await mind.revoke("bond", c.id);
  await load();
  if (person.value) {
    person.value = bonds.value.people.find(
      (p: any) => p.userId === person.value.userId,
    );
    changes.value = await mind.bondChanges("person", person.value.userId);
  }
  emit("changed");
}
async function toggleFace(session: string) {
  if (faceHistory.value[session]) {
    const { [session]: _drop, ...rest } = faceHistory.value;
    faceHistory.value = rest;
    return;
  }
  faceHistory.value = {
    ...faceHistory.value,
    [session]: await mind.faces(session),
  };
}
async function revokeFace(session: string, id: string) {
  if (!confirm("撤销这一版面貌？她在这个群会回到上一版的样子。")) return;
  await mind.revoke("face", id);
  faceHistory.value = {
    ...faceHistory.value,
    [session]: await mind.faces(session),
  };
  await load();
}
onMounted(load);
</script>

<template>
  <section v-if="bonds" class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">PEOPLE / 同一个人，在哪里都是同一个人</span>
        <h3>她认识的人 · {{ bonds.people.length }}</h3>
      </div>
    </div>
    <div v-if="bonds.people.length" class="people-grid">
      <button
        v-for="p in bonds.people"
        :key="p.userId"
        type="button"
        class="person-card"
        :class="{ selected: person?.userId === p.userId }"
        @click="choose(p)"
      >
        <h4>{{ p.name }}</h4>
        <small
          >{{ p.feel }} · 在 {{ p.sessions.length }} 个地方见过<template
            v-if="knownFor(p)"
          >
            · {{ knownFor(p) }}</template
          >
          · 上次说上话 {{ when(p.lastTalkedAt) }} · 上次见到
          {{ when(p.seenAt || p.lastSeen) }}</small
        >
        <div v-for="[key, label] in DIMENSIONS" :key="key" class="meter-row">
          <span>{{ label }}</span>
          <div class="meter" :class="{ warn: key === 'tension' }">
            <i :style="{ width: percent(p[key]) }"></i>
          </div>
          <em>{{ percent(p[key]) }}</em>
        </div>
        <small v-if="p.impression">印象：{{ p.impression }}</small>
      </button>
    </div>
    <div v-else class="gentle-empty">
      <b>她还没有认识谁</b>
      <p>有人和她说话、她细看过群聊之后，这里会出现她对每个人的感觉。</p>
    </div>
  </section>

  <section v-if="person" class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">HOW IT CHANGED</span>
        <h3>她对 {{ person.name }} 的感觉是怎么来的</h3>
      </div>
      <button type="button" class="text-button" @click="person = null">
        关闭
      </button>
    </div>
    <div v-if="changes.length" class="row-list">
      <article v-for="c in changes" :key="c.id">
        <time>{{ when(c.created) }}</time>
        <span
          class="tag"
          :data-kind="
            ['friction', 'trust_down', 'distance'].includes(c.change)
              ? 'decline'
              : ''
          "
          >{{ CHANGE[c.change] || c.change }}</span
        >
        <div>
          <p>{{ c.note || "没有写原因" }}</p>
          <small
            >{{ ORIGIN_LABELS[c.origin] || "写日记时" }} ·
            {{ c.sources.length }} 处来源
            <button type="button" class="text-button" @click="revokeChange(c)">
              撤销
            </button></small
          >
        </div>
      </article>
    </div>
    <p v-else class="gentle-empty">只是一起聊过天，还没有特别的变化。</p>
  </section>

  <section v-if="bonds" class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">FACES / 她在每个地方的样子</span>
        <h3>在不同的群里，她是什么样的</h3>
        <p class="small">
          面貌由她在独处和写日记时自己修正，吸收那个群的说话习惯；每一版都有来源。
        </p>
      </div>
    </div>
    <div class="people-grid">
      <article
        v-for="g in bonds.groups"
        :key="g.session"
        class="person-card face-card"
      >
        <h4>{{ g.name }}</h4>
        <small
          >{{ g.kind === "private" ? "私聊" : "群聊"
          }}{{ g.bond ? ` · ${g.bond.feel}` : "" }}</small
        >
        <dl v-if="g.face">
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
        <p v-else class="small">还没有形成在这里的样子。</p>
        <button
          type="button"
          class="text-button"
          @click="toggleFace(g.session)"
        >
          {{ faceHistory[g.session] ? "收起变化" : "变化历史 ↗" }}
        </button>
        <div v-if="faceHistory[g.session]" class="thread-history">
          <div v-for="f in faceHistory[g.session]" :key="f.id">
            <time>{{ when(f.created) }}</time>
            <b>{{
              f.revoked ? "撤销" : f.origin === "migration" ? "旧版" : ""
            }}</b>
            <span
              >{{
                [f.role, f.tone, f.aspiration].filter(Boolean).join(" · ") ||
                f.content
              }}
              <button
                v-if="!f.revoked"
                type="button"
                class="text-button"
                @click="revokeFace(g.session, f.id)"
              >
                撤销
              </button></span
            >
          </div>
          <p v-if="!faceHistory[g.session].length" class="small">没有记录。</p>
        </div>
      </article>
    </div>
  </section>
</template>
