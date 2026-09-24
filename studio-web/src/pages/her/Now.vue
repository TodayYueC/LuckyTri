<script setup lang="ts">
import { computed, ref } from "vue";
import { toast } from "../../api";
import {
  ANTICIPATION_LABELS,
  CHOICE_LABELS,
  mind,
  percent,
  when,
} from "../../plates/mind";

const props = defineProps<{ data: any }>();
const emit = defineEmits<{ changed: [] }>();
const busy = ref(false);
const usage = computed(() => props.data.budget.usage);
const limits = computed(() => props.data.budget.limits);
const categories = [
  { id: "conversation", label: "对话" },
  { id: "inner", label: "独处与日记" },
  { id: "upkeep", label: "整理记忆" },
];

async function run(kind: "reflect" | "review") {
  busy.value = true;
  try {
    const result = await mind[kind]();
    toast(result.reason || "完成", result.status === "error");
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
function share(id: string) {
  const limit = limits.value[id];
  return limit ? usage.value[id] / limit : 0;
}
</script>

<template>
  <section class="inner-layout">
    <article class="inner-card surface">
      <div
        class="inner-sky"
        :style="{ '--glow': String(0.35 + data.affect.energy * 0.65) }"
        aria-hidden="true"
      >
        <span></span><b>◌</b>
      </div>
      <div class="inner-copy">
        <span class="eyebrow">INNER WEATHER / 此刻</span>
        <h3>{{ data.affect.mood }}</h3>
        <p class="inner-narrative">
          {{
            data.affect.cause
              ? `因为${data.affect.cause}。`
              : "没有特别牵动她的事，心情慢慢回到平常。"
          }}
        </p>
        <div class="state-chips">
          <span>{{ data.affect.phaseLabel }}</span>
          <span>精力 · {{ data.affect.energyLabel }}</span>
          <span v-if="data.affect.lately">{{ data.affect.lately }}</span>
          <span>来到这里的第 {{ data.dayOfLife }} 天</span>
          <span>两小时内说了 {{ data.affect.talkedRecently }} 句</span>
          <span v-if="data.nature.rhythm.enabled"
            >作息 · {{ data.nature.rhythm.wake }} 醒 /
            {{ data.nature.rhythm.sleep }} 睡</span
          >
        </div>
      </div>
    </article>
    <aside class="attention-card surface">
      <span class="eyebrow">A LIFE OF HER OWN</span>
      <h3>她的一天</h3>
      <dl>
        <div>
          <dt>自我线索</dt>
          <dd>
            {{ data.counts.self }} 条<small v-if="data.counts.faded">
              · 淡出 {{ data.counts.faded }}</small
            >
          </dd>
        </div>
        <div>
          <dt>认识的人</dt>
          <dd>{{ data.counts.people }} 位</dd>
        </div>
        <div>
          <dt>手记</dt>
          <dd>{{ data.counts.thoughts }} 篇</dd>
        </div>
        <div>
          <dt>日记 / 回顾 / 自传</dt>
          <dd>
            {{ data.counts.diaries }} 天 / {{ data.counts.reviews }} 次 /
            {{ data.counts.chapters }} 章
          </dd>
        </div>
        <div>
          <dt>在等的事</dt>
          <dd>{{ data.counts.anticipations }} 件</dd>
        </div>
      </dl>
      <button
        type="button"
        class="primary"
        :disabled="busy || data.busy"
        @click="run('reflect')"
      >
        {{ busy || data.busy ? "她正在想…" : "现在独处一会儿" }}
      </button>
      <button
        type="button"
        :disabled="busy || data.busy"
        @click="run('review')"
      >
        写下今天的日记
      </button>
      <small>{{ data.reason || "安静下来时，她会自己独处。" }}</small>
    </aside>
  </section>

  <section class="now-grid">
    <article class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">WHY SHE SPOKE, OR DIDN'T</span>
          <h3>最近为什么说、为什么没说</h3>
        </div>
      </div>
      <div v-if="data.choices.length" class="choice-list">
        <article v-for="c in data.choices.slice(0, 14)" :key="c.id">
          <time
            >{{ when(c.created) }}<small>{{ c.sessionName }}</small></time
          >
          <span class="tag" :data-kind="c.choice">{{
            CHOICE_LABELS[c.choice] || c.choice
          }}</span>
          <div>
            <p>{{ c.reason }}</p>
            <small v-if="c.appraisal">{{ c.appraisal }}</small>
          </div>
        </article>
      </div>
      <div v-else class="gentle-empty">
        <b>她还没有真正看过哪段对话</b>
        <p>只扫一眼的群聊不会留在这里；她细看、并做出选择时才会记下理由。</p>
      </div>
    </article>
    <article class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">ATTENTION</span>
          <h3>在哪里还有没细看的消息</h3>
        </div>
      </div>
      <div v-if="data.attention.length" class="row-list">
        <article v-for="a in data.attention" :key="a.session">
          <time>{{ when(a.lookedAt) }}</time>
          <span class="tag" :data-kind="a.unread ? 'emerging' : 'glanced'"
            >{{ a.unread }} 条未读</span
          >
          <p>{{ a.name }}</p>
        </article>
      </div>
      <div v-else class="gentle-empty">
        <b>还没有打开注意力的会话</b>
        <p>被叫到、聊到她在意的事、熟人说话或攒了不少消息时，她才会细看。</p>
      </div>
      <div class="section-heading" style="margin-top: 24px">
        <div>
          <span class="eyebrow">AHEAD / 7 DAYS</span>
          <h3>这几天她在等的事</h3>
        </div>
      </div>
      <div v-if="data.expecting.length" class="row-list">
        <article v-for="a in data.expecting" :key="a.id">
          <time>{{ when(a.occurrence) }}</time>
          <span class="tag" data-kind="emerging">{{ a.when }}</span>
          <p>
            {{ a.name ? `${a.name}：` : "" }}{{ a.content
            }}<small>{{ ANTICIPATION_LABELS[a.kind] || a.kind }}</small>
          </p>
        </article>
      </div>
      <p v-else class="gentle-empty">这几天没有她特别在等的事。</p>
      <div class="section-heading" style="margin-top: 24px">
        <div>
          <span class="eyebrow">TOKEN LEDGER / 24H</span>
          <h3>今天的注意力花在哪里</h3>
        </div>
      </div>
      <div class="row-list">
        <div
          v-for="c in categories"
          :key="c.id"
          class="meter-row"
          style="padding: 8px 0"
        >
          <span>{{ c.label }}</span>
          <div class="meter" :class="{ warn: share(c.id) >= 0.8 }">
            <i
              :style="{
                width: limits[c.id]
                  ? percent(share(c.id))
                  : percent(usage.total ? usage[c.id] / usage.total : 0),
              }"
            ></i>
          </div>
          <em>{{ Number(usage[c.id] || 0).toLocaleString() }}</em>
        </div>
      </div>
      <p class="setting-note" style="margin-top: 12px">
        共 {{ usage.calls }} 次调用、{{
          Number(usage.total).toLocaleString()
        }}
        Token，其中缓存命中 {{ Number(usage.cached).toLocaleString() }}。{{
          limits.total
            ? `每日上限 ${Number(limits.total).toLocaleString()}，后台最多用 ${Number(limits.inner).toLocaleString()} + ${Number(limits.upkeep).toLocaleString()}。`
            : "没有设置每日上限。"
        }}
      </p>
    </article>
  </section>

  <section class="surface">
    <div class="section-heading">
      <div>
        <span class="eyebrow">MOOD TRAIL</span>
        <h3>心情是怎样变过来的</h3>
      </div>
    </div>
    <div v-if="data.moods.length" class="row-list">
      <article v-for="m in data.moods.slice(0, 12)" :key="m.id">
        <time>{{ when(m.created) }}</time>
        <span class="tag" :data-kind="m.valence < 0 ? 'decline' : ''">{{
          m.feeling
        }}</span>
        <p>
          {{ m.cause || "说不清为什么"
          }}<small
            >{{
              {
                turn: "聊天时",
                solitude: "独处时",
                daily: "写日记时",
                migration: "旧版本留下的",
              }[m.origin as string] || m.origin
            }}
            · 强度 {{ percent(m.intensity) }}</small
          >
        </p>
      </article>
    </div>
    <div v-else class="gentle-empty">
      <b>心情还没有被什么事牵动过</b>
      <p>每一次经历都可能推动她的心情，随后又会慢慢回到平常。</p>
    </div>
  </section>
</template>
