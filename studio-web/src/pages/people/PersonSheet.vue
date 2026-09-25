<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { toast } from "../../api";
import { ask, askText } from "../../dialog";
import {
  ANTICIPATION_LABELS,
  ANTICIPATION_STATES,
  CHANGE_LABELS,
  COOLING,
  DIMENSIONS,
  DISCRETION,
  MEMORY_STATUS,
  ORIGIN_LABELS,
  mind,
  when,
} from "../../plates/mind";
import { patchMemory } from "../../plates/knowledge";
import { ago, hueOf, initials, placeName } from "../../format";
import Sheet from "../../components/ui/Sheet.vue";
import Select from "../../components/ui/Select.vue";
import Ring from "../../components/ui/Ring.vue";

const props = defineProps<{ id: string | null; now?: number }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const data = ref<any>(null);
const error = ref("");

const person = computed(() => data.value?.person);
const knownDays = computed(() => {
  const first = person.value?.firstMetAt;
  if (!first) return "";
  return `认识 ${Math.max(1, Math.round(((props.now || Date.now()) - first) / 86400000))} 天`;
});

async function load() {
  if (!props.id) return;
  error.value = "";
  try {
    data.value = await mind.person(props.id);
  } catch (e) {
    data.value = null;
    error.value = (e as Error).message;
  }
}

async function revokeChange(c: any) {
  if (
    !(await ask(
      `撤销这次「${CHANGE_LABELS[c.change] || c.change}」？TA 对这个人的感觉会重新计算。`,
      {
        title: "撤销一次关系变化",
        confirmText: "撤销",
        danger: true,
      },
    ))
  )
    return;
  try {
    await mind.revoke("bond", c.id);
    toast("已撤销");
    await load();
    emit("changed");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function revokeMemory(m: any) {
  const reason = await askText(
    `撤销「${m.content}」？TA 之后不会再这样认为，整理记忆时也不会把它写回来。可以写下原因（可不填）：`,
    {
      title: "撤销这条记忆",
      confirmText: "撤销",
      danger: true,
      placeholder: "原因",
    },
  );
  if (reason === null) return;
  try {
    await mind.revoke("memory", m.id, reason);
    toast("已撤销");
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function patch(m: any, body: Record<string, unknown>) {
  try {
    await patchMemory(m.id, body);
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function revokeAhead(a: any) {
  const reason = await askText(
    `撤销「${a.content}」？TA 不再惦记这件事，之后整理记忆时也不会把它写回来。可以写下原因（可不填）：`,
    {
      title: "撤销这个约定",
      confirmText: "撤销",
      danger: true,
      placeholder: "原因",
    },
  );
  if (reason === null) return;
  try {
    await mind.revoke("anticipation", a.id, reason);
    toast("已撤销");
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

watch(
  () => props.id,
  (id) => {
    data.value = null;
    if (id) load();
  },
  { immediate: true },
);
</script>

<template>
  <Sheet
    :open="Boolean(id)"
    :title="person?.name || '正在想起…'"
    eyebrow="TA 认识的人"
    width="560px"
    @close="emit('close')"
  >
    <p v-if="error" class="error-text">{{ error }}</p>
    <div v-else-if="person" class="person-sheet stack">
      <header class="who">
        <span
          class="avatar"
          :style="{ '--hue': hueOf(person.name || person.userId) }"
          >{{ initials(person.name) }}</span
        >
        <div>
          <p class="feel">{{ person.feel }}</p>
          <small class="qq">QQ {{ person.userId }}</small>
          <small class="muted">
            {{
              [
                knownDays,
                person.lastTalkedAt
                  ? `上次说上话 ${ago(person.lastTalkedAt, now)}`
                  : "还没说上过话",
                person.seenAt ? `上次见到 ${ago(person.seenAt, now)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")
            }}
          </small>
        </div>
      </header>
      <div class="rings">
        <Ring
          v-for="[key, label] in DIMENSIONS"
          :key="key"
          :value="person[key]"
          :label="label"
        />
      </div>
      <p v-if="person.impression" class="impression">
        印象：{{ person.impression }}
      </p>
      <div v-if="person.places?.length" class="row">
        <span class="faint">在这些地方见过：</span>
        <span
          v-for="p in person.places"
          :key="p.id"
          class="chip"
          data-tone="quiet"
          >{{ p.name }}</span
        >
      </div>

      <section>
        <h3 class="sheet-title">这份感觉是怎么来的</h3>
        <ul v-if="data.changes.length" class="list">
          <li
            v-for="c in data.changes"
            :key="c.id"
            class="change"
            :class="{ done: c.revoked }"
          >
            <span
              class="chip"
              :data-tone="
                c.revoked
                  ? 'quiet'
                  : COOLING.has(c.change)
                    ? 'danger'
                    : undefined
              "
              >{{ CHANGE_LABELS[c.change] || c.change }}</span
            >
            <div class="grow">
              <p>{{ c.note || "没有写原因" }}</p>
              <small class="faint"
                >{{ when(c.created) }} ·
                {{ ORIGIN_LABELS[c.origin] || "写日记时" }} ·
                {{ c.sources.length }} 处来源</small
              >
            </div>
            <span v-if="c.revoked" class="chip" data-tone="quiet">已撤销</span>
            <button
              v-else
              class="text-button"
              data-revoke-change
              @click="revokeChange(c)"
            >
              撤销
            </button>
          </li>
        </ul>
        <p v-else class="muted">只是一起聊过天，还没有特别的变化。</p>
      </section>

      <section>
        <h3 class="sheet-title">TA 记得关于{{ person.name }}的事</h3>
        <ul v-if="data.memories.length" class="list">
          <li
            v-for="m in data.memories"
            :key="m.id"
            class="memory-item"
            :class="{ superseded: m.status === 'superseded' }"
          >
            <p>{{ m.content }}</p>
            <small class="faint">
              {{ MEMORY_STATUS[m.status] || m.status }} · 在「{{
                placeName({ name: m.sessionName, id: m.session_id || m.sessionId })
              }}」知道的 · {{ m.when }}
            </small>
            <div v-if="m.status === 'confirmed'" class="instant">
              <span class="faint">改完即生效</span>
              <Select
                :aria-label="'分寸：' + m.content"
                :model-value="m.discretion || 'open'"
                :options="
                  Object.entries(DISCRETION).map(([key, label]) => ({
                    value: key,
                    label,
                  }))
                "
                @update:model-value="patch(m, { discretion: $event })"
              />
              <button class="small" @click="patch(m, { locked: !m.locked })">
                {{ m.locked ? "解锁" : "锁定" }}
              </button>
              <button class="small danger" @click="revokeMemory(m)">
                撤销
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="muted">还没有记住关于这个人的事。</p>
      </section>

      <section>
        <h3 class="sheet-title">和{{ person.name }}有关的约定</h3>
        <ul v-if="data.anticipations.length" class="list">
          <li
            v-for="a in data.anticipations"
            :key="a.id"
            class="change"
            :class="{ done: a.state !== 'pending' }"
          >
            <span
              class="chip"
              :data-tone="a.state === 'pending' ? undefined : 'quiet'"
              >{{ ANTICIPATION_STATES[a.state] || a.state }}</span
            >
            <div class="grow">
              <p>{{ a.content }}</p>
              <small class="faint"
                >{{ ANTICIPATION_LABELS[a.kind] || a.kind }} ·
                {{ a.when }}</small
              >
            </div>
            <button
              v-if="a.status !== 'revoked'"
              class="text-button"
              @click="revokeAhead(a)"
            >
              撤销
            </button>
          </li>
        </ul>
        <p v-else class="muted">没有和这个人有关的约定。</p>
      </section>
    </div>
  </Sheet>
</template>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 30%,
    hsl(var(--hue) 90% 92%),
    hsl(var(--hue) 65% 72%)
  );
  color: hsl(var(--hue) 45% 22%);
  font: 700 19px var(--font-display);
}
.feel {
  font: 600 17px/1.5 var(--font-display);
}
.rings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 14px 8px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.impression {
  padding: 10px 14px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 12px 12px 0;
  font-size: 14px;
}
.sheet-title {
  margin-bottom: 10px;
  font-size: 14px;
}
.change {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 75%, transparent);
  border: 1px solid var(--line);
}
.change p {
  font-size: 13.5px;
}
.change.done {
  opacity: 0.65;
}
.grow {
  flex: 1;
  min-width: 0;
}
.instant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.instant select {
  width: auto;
  min-width: 128px;
}
.memory-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 75%, transparent);
  border: 1px solid var(--line);
}
.memory-item p {
  font-size: 14px;
}
.memory-item select {
  width: auto;
  padding: 5px 10px;
  font-size: 12.5px;
}
.memory-item.superseded {
  opacity: 0.6;
  border-style: dashed;
}
.memory-item.superseded p {
  text-decoration: line-through;
  text-decoration-color: var(--ink-faint);
}
.person-sheet {
  gap: 17px;
}
.who {
  position: relative;
  overflow: hidden;
  padding: 18px;
  border-radius: 25px;
  border: 1px solid #fff;
  background: linear-gradient(125deg, #ffffffc9, #dfeeff85 65%, #f5e5f58c);
  box-shadow:
    inset 0 2px 0 #fff,
    0 17px 26px -24px #5473a6;
}
.who::after {
  content: "";
  position: absolute;
  width: 170px;
  height: 170px;
  right: -90px;
  top: -100px;
  border-radius: 50%;
  background: #d3dcff9a;
  filter: blur(25px);
}
.who .avatar {
  position: relative;
  z-index: 1;
  border: 1px solid #fff;
  box-shadow:
    inset 3px 3px 4px #fff,
    inset -4px -4px 8px #acc5e77a,
    0 9px 17px -10px #5376ab;
}
.who > div {
  min-width: 0;
  position: relative;
  z-index: 1;
}
.feel {
  font-size: 18px;
  letter-spacing: -0.02em;
}
.rings {
  gap: 8px;
  padding: 13px;
  border: 1px solid #fff;
  border-radius: 24px;
  background: linear-gradient(145deg, #ffffffba, #ffffff68);
  box-shadow: inset 0 1px 0 #fff;
}
.impression {
  padding: 14px 17px;
  border: 1px solid #fff;
  border-left: 3px solid var(--accent);
  border-radius: 17px;
  background: #ffffff9e;
  box-shadow: inset 0 1px 0 #fff;
  line-height: 1.75;
}
.sheet-title {
  margin-bottom: 11px;
  font-size: 15px;
}
.change,
.memory-item {
  border: 1px solid #ffffffe3;
  border-radius: 19px;
  background: linear-gradient(135deg, #ffffffc5, #ffffff76);
  box-shadow: inset 0 1px 0 #fff;
  transition:
    transform 0.4s var(--spring),
    box-shadow 0.24s;
}
.change:hover,
.memory-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 21px -18px #597aad;
}
@media (max-width: 510px) {
  .rings {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
