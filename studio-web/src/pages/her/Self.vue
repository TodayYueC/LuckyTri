<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toast } from "../../api";
import {
  ORIGIN_LABELS as ORIGIN,
  mind,
  percent,
  when,
} from "../../plates/mind";

defineProps<{ data: any }>();
const emit = defineEmits<{ changed: [] }>();
const self = ref<any>(null);
const open = ref<Record<string, any[]>>({});
const STATUS: Record<string, string> = {
  active: "已经是她的一部分",
  emerging: "刚开始有这种感觉",
  closed: "已经放下",
};

async function load() {
  try {
    self.value = await mind.self();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
const groups = computed(() => {
  if (!self.value) return [];
  const kinds = self.value.kinds as Record<string, string>;
  return Object.entries(kinds)
    .map(([kind, label]) => ({
      kind,
      label,
      threads: self.value.threads.filter(
        (t: any) => t.kind === kind && t.status !== "closed" && !t.faded,
      ),
    }))
    .filter((g) => g.threads.length);
});
const closed = computed(
  () => self.value?.threads.filter((t: any) => t.status === "closed") || [],
);
const faded = computed(
  () =>
    self.value?.threads.filter((t: any) => t.faded && t.status !== "closed") ||
    [],
);
function tag(t: any) {
  if (t.core) return "她最核心的部分";
  if (t.fading) return "慢慢淡出";
  return STATUS[t.status] || t.status;
}
async function toggle(thread: string) {
  if (open.value[thread]) {
    const { [thread]: _drop, ...rest } = open.value;
    open.value = rest;
    return;
  }
  open.value = { ...open.value, [thread]: await mind.thread(thread) };
}
async function revoke(t: any) {
  const reason = prompt(
    `撤销「${t.content}」？撤销后她不会再这样认为，之后的独处也不会把它写回来。可以写下原因：`,
    "",
  );
  if (reason === null) return;
  await mind.revoke("self", t.thread, reason);
  toast("已撤销");
  await load();
  emit("changed");
}
onMounted(load);
</script>

<template>
  <section v-if="self" class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">WHO SHE IS BECOMING</span>
        <h3>她从经历里长出来的自己</h3>
        <p class="small">
          每一条都指向真实发生过的事。一次经历只让它变一点；新的特质要在不同的日子里反复出现才会成形。你可以撤销，但不能替她改写。
        </p>
      </div>
    </div>
    <div v-if="groups.length" class="thread-groups">
      <div v-for="g in groups" :key="g.kind">
        <h4>{{ g.label }} · {{ g.threads.length }}</h4>
        <article v-for="t in g.threads" :key="t.thread" class="thread">
          <header>
            <span class="tag" :data-kind="t.fading ? 'glanced' : t.status">{{
              tag(t)
            }}</span>
            <small
              >最近一次被触及 {{ when(t.created) }} ·
              {{ ORIGIN[t.origin] || t.origin }}</small
            >
          </header>
          <p>{{ t.content }}</p>
          <div class="meter-row">
            <span>强度</span>
            <div class="meter">
              <i :style="{ width: percent(t.strength) }"></i>
            </div>
            <em>{{ percent(t.strength) }}</em>
          </div>
          <div v-if="t.salience !== null" class="meter-row">
            <span>此刻的分量</span>
            <div class="meter">
              <i :style="{ width: percent(t.salience) }"></i>
            </div>
            <em>{{ percent(t.salience) }}</em>
          </div>
          <footer>
            <span>{{ t.days.length }} 天的经历</span>
            <span>{{ t.sources.length }} 处来源</span>
            <button type="button" class="text-button" @click="toggle(t.thread)">
              {{ open[t.thread] ? "收起变化" : `${t.versions} 个版本 ↗` }}
            </button>
            <button type="button" class="text-button" @click="revoke(t)">
              撤销
            </button>
          </footer>
          <div v-if="open[t.thread]" class="thread-history">
            <div v-for="v in open[t.thread]" :key="v.id">
              <time>{{ when(v.created) }}</time>
              <b>{{ percent(v.strength) }}</b>
              <span>{{ v.content }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>
    <div v-else class="gentle-empty">
      <b>她还没有长出关于自己的东西</b>
      <p>
        聊得多了、独处过、写过日记，她会慢慢发现自己喜欢什么、怎么看事情、想做什么。天性只是种子。
      </p>
    </div>
  </section>
  <section v-if="self && faded.length" class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">FADED / 很久没被触及</span>
        <h3>慢慢淡出的 · {{ faded.length }}</h3>
        <p class="small">
          她过了很多有经历的日子都没再碰到这些，它们暂时不在她心上，但没有被删掉：有人再聊起相关的事，它们会被重新想起。
        </p>
      </div>
    </div>
    <div class="row-list">
      <article v-for="t in faded" :key="t.thread" class="faded-thread">
        <time>{{ when(t.created) }}</time>
        <span class="tag" data-kind="glanced">{{
          self.kinds[t.kind] || t.kind
        }}</span>
        <p>
          {{ t.content
          }}<small
            >强度 {{ percent(t.strength) }} · 此刻的分量
            {{ percent(t.salience) }}</small
          >
        </p>
      </article>
    </div>
  </section>
  <section
    v-if="self && (closed.length || self.revoked.length)"
    class="now-grid"
  >
    <article class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">SET ASIDE</span>
          <h3>她自己放下的</h3>
        </div>
      </div>
      <div class="row-list">
        <article v-for="t in closed" :key="t.thread">
          <time>{{ when(t.created) }}</time>
          <span class="tag" data-kind="closed">放下</span>
          <p>{{ t.content }}</p>
        </article>
      </div>
      <p v-if="!closed.length" class="gentle-empty">没有。</p>
    </article>
    <article class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">WITHDRAWN</span>
          <h3>你撤销过的</h3>
        </div>
      </div>
      <div class="row-list">
        <article v-for="r in self.revoked" :key="r.id">
          <time>{{ when(r.created) }}</time>
          <span class="tag" data-kind="decline">撤销</span>
          <p>
            {{ r.content }}<small v-if="r.reason">{{ r.reason }}</small>
          </p>
        </article>
      </div>
      <p v-if="!self.revoked.length" class="gentle-empty">没有。</p>
    </article>
  </section>
</template>
