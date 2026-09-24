<script setup lang="ts">
import { onMounted, ref } from "vue";
import { toast } from "../../api";
import {
  ANTICIPATION_LABELS,
  ANTICIPATION_STATES,
  mind,
  when,
} from "../../plates/mind";

defineProps<{ data: any }>();
const emit = defineEmits<{ changed: [] }>();
const life = ref<any>(null);
const query = ref("");
const day = ref<any>(null);
const versions = ref<Record<number, any[]>>({});
const stories = ref<any[] | null>(null);
const RUN_KIND: Record<string, string> = {
  solitude: "独处",
  daily: "日记",
  night: "夜里整理",
  weekly: "回顾",
};
const RUN: Record<string, string> = {
  written: "留下了东西",
  state: "心情变了",
  empty: "没有新想法",
  error: "没完成",
  cancelled: "作废了",
  interrupted: "重启中断",
  running: "正在进行",
};

async function load() {
  try {
    life.value = await mind.life(query.value);
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function openDay(value: string) {
  day.value = day.value?.day === value ? null : await mind.day(value);
}
async function toggleChapter(n: number) {
  if (versions.value[n]) {
    const { [n]: _drop, ...rest } = versions.value;
    versions.value = rest;
    return;
  }
  versions.value = { ...versions.value, [n]: await mind.chapter(n) };
}
async function toggleStory() {
  stories.value = stories.value ? null : await mind.story();
}
async function revokeAhead(a: any) {
  const reason = prompt(
    `撤销「${a.content}」？她不再惦记这件事，之后整理记忆时也不会把它写回来。可以写下原因：`,
    "",
  );
  if (reason === null) return;
  try {
    await mind.revoke("anticipation", a.id, reason);
    toast("已撤销");
    await load();
    emit("changed");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function update(t: any, value: unknown) {
  await mind.thought(t.id, value);
  await load();
  emit("changed");
}
async function remove(t: any) {
  if (!confirm("删除这篇手记？有后续修正的手记只能隐藏。")) return;
  try {
    await mind.removeThought(t.id);
    await load();
  } catch (error) {
    toast((error as Error).message, true);
  }
}
onMounted(load);
</script>

<template>
  <div v-if="life" class="life-grid">
    <section class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">DIARY / 睡前写给自己的</span>
          <h3>她的日记 · {{ life.diaries.length }} 天</h3>
        </div>
      </div>
      <article v-for="d in life.diaries" :key="d.id" class="diary-entry">
        <div class="day">{{ d.day.slice(5) }}</div>
        <div>
          <p>{{ d.content }}</p>
          <small v-if="d.mood" class="tag">{{ d.mood }}</small>
          <blockquote v-if="d.compare">
            和昨天的自己比：{{ d.compare }}
          </blockquote>
          <button type="button" class="text-button" @click="openDay(d.day)">
            {{ day?.day === d.day ? "收起那天的她" : "那天的她 ↗" }}
          </button>
          <div v-if="day?.day === d.day && day.change" class="day-diff">
            <div v-if="day.change.appeared.length">
              <b>多了：</b
              >{{ day.change.appeared.map((t: any) => t.content).join("；") }}
            </div>
            <div v-if="day.change.changed.length">
              <b>变了：</b
              >{{
                day.change.changed
                  .map((t: any) => `${t.before.content} → ${t.content}`)
                  .join("；")
              }}
            </div>
            <div v-if="day.change.faded.length">
              <b>放下了：</b
              >{{ day.change.faded.map((t: any) => t.content).join("；") }}
            </div>
            <div>
              <b>心情：</b>{{ day.change.mood.before || "—" }} →
              {{ day.change.mood.after || "—" }}
            </div>
          </div>
          <p v-else-if="day?.day === d.day" class="small">
            这是她留下快照的第一天，还没有可以对照的昨天。
          </p>
        </div>
      </article>
      <div v-if="!life.diaries.length" class="gentle-empty">
        <b>还没有日记</b>
        <p>
          每天睡前（或凌晨），如果这一天真的有过经历，她会写下来，并和昨天的自己对照。
        </p>
      </div>
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">AUTOBIOGRAPHY</span>
          <h3>她写的自己的故事</h3>
          <p class="small">
            她在夜里回顾时，会改写正在经历的这一章，或者觉得日子换了样子、翻开新的一章。旧的版本都留着。
          </p>
        </div>
      </div>
      <article v-if="life.story" class="chapter-card story-card">
        <h4>我的来路 · 第 {{ life.dayOfLife }} 天</h4>
        <p>{{ life.story.content }}</p>
        <button
          v-if="life.storyVersions > 1"
          type="button"
          class="text-button"
          @click="toggleStory"
        >
          {{ stories ? "收起旧版本" : `重写过 ${life.storyVersions - 1} 次 ↗` }}
        </button>
        <div v-if="stories" class="thread-history">
          <div v-for="v in stories.slice(1)" :key="v.id">
            <time>{{ when(v.created) }}</time>
            <b>旧版</b>
            <span>{{ v.content }}</span>
          </div>
        </div>
      </article>
      <article v-for="c in life.chapters" :key="c.id" class="chapter-card">
        <h4>第 {{ c.chapter }} 章 · {{ c.title }}</h4>
        <p>{{ c.content }}</p>
        <button
          v-if="c.versions > 1"
          type="button"
          class="text-button"
          @click="toggleChapter(c.chapter)"
        >
          {{
            versions[c.chapter] ? "收起旧版本" : `重写过 ${c.versions - 1} 次 ↗`
          }}
        </button>
        <div v-if="versions[c.chapter]" class="thread-history">
          <div v-for="v in versions[c.chapter].slice(1)" :key="v.id">
            <time>{{ when(v.created) }}</time>
            <b>旧版</b>
            <span>{{ v.title }}：{{ v.content }}</span>
          </div>
        </div>
      </article>
      <div v-if="!life.chapters.length" class="gentle-empty">
        <b>自传还没开始写</b>
        <p>有了两篇日记之后，她会在夜里第一次回顾，写下第一章。</p>
      </div>
    </section>

    <section class="surface">
      <div class="section-heading">
        <div>
          <span class="eyebrow">LOOKING BACK / 隔一段时间</span>
          <h3>她的回顾 · {{ life.reviews.length }}</h3>
          <p class="small">
            每隔一段时间，她在夜里重新看看这段日子：留下了什么、自己怎样在变。
          </p>
        </div>
      </div>
      <article v-for="r in life.reviews" :key="r.id" class="diary-entry">
        <div class="day">{{ when(r.created).slice(0, 5) }}</div>
        <div>
          <p>{{ r.content }}</p>
          <blockquote v-if="r.compare">
            和上次回顾比：{{ r.compare }}
          </blockquote>
        </div>
      </article>
      <div v-if="!life.reviews.length" class="gentle-empty">
        <b>还没有回顾过</b>
        <p>日记攒到两篇以后，她会在睡着的时候第一次回顾。</p>
      </div>
    </section>

    <section class="surface" style="grid-column: 1 / -1">
      <div class="section-heading">
        <div>
          <span class="eyebrow">AHEAD / 她在等的事</span>
          <h3>约定与期待</h3>
          <p class="small">
            别人说起的安排、她答应的事、她想做的事和每年都会回来的日子。临近时她会记得，有了结果会放下；过了很久没有结果的，会悄悄算作错过。
          </p>
        </div>
      </div>
      <div v-if="life.anticipations.length" class="row-list">
        <article
          v-for="a in life.anticipations"
          :key="a.id"
          :class="{ muted: a.state !== 'pending' }"
        >
          <time>{{ when(a.occurrence) }}</time>
          <span
            class="tag"
            :data-kind="
              ['missed', 'lapsed', 'revoked'].includes(a.state)
                ? 'decline'
                : a.state === 'pending'
                  ? 'emerging'
                  : ''
            "
            >{{ ANTICIPATION_STATES[a.state] || a.state }}</span
          >
          <div>
            <p>
              {{ a.name ? `${a.name}：` : "" }}{{ a.content
              }}<small
                >{{ ANTICIPATION_LABELS[a.kind] || a.kind }} · {{ a.when
                }}{{ a.recurrence === "yearly" ? " · 每年" : ""
                }}{{ a.private ? " · 私下知道的" : ""
                }}{{ a.closed_note ? ` · ${a.closed_note}` : "" }}</small
              >
            </p>
            <button
              v-if="a.status !== 'revoked'"
              type="button"
              class="text-button"
              @click="revokeAhead(a)"
            >
              撤销
            </button>
          </div>
        </article>
      </div>
      <p v-else class="gentle-empty">
        还没有她在等的事。有人说起之后的安排、她答应了别人什么，整理记忆时会记下来。
      </p>
    </section>

    <section class="surface" style="grid-column: 1 / -1">
      <div class="section-heading">
        <div>
          <span class="eyebrow">READING / 读过才能说读过</span>
          <h3>她读过的</h3>
          <p class="small">
            独处时，她会从共享知识库里挑自己感兴趣的读，一段一段地读下去，读后的想法可以改变她。还有
            {{ life.unread }} 段没读。
          </p>
        </div>
      </div>
      <div v-if="life.readings.length" class="row-list">
        <article v-for="r in life.readings" :key="r.id">
          <time>{{ when(r.created) }}</time>
          <span class="tag">第 {{ r.ordinal + 1 }} / {{ r.total }} 段</span>
          <p>
            《{{ r.title }}》<small>{{ r.note || "读完没说什么" }}</small>
          </p>
        </article>
      </div>
      <p v-else class="gentle-empty">
        还没读过什么。把文章放进「记忆 →
        文档知识库」的共享集合，她独处时会去读。
      </p>
    </section>

    <section class="surface" style="grid-column: 1 / -1">
      <div class="section-heading">
        <div>
          <span class="eyebrow">JOURNAL / 后来想到的</span>
          <h3>手记</h3>
        </div>
        <input
          v-model="query"
          placeholder="搜索某件事、某个人"
          aria-label="搜索手记"
          @change="load"
        />
      </div>
      <article
        v-for="(t, i) in life.thoughts"
        :key="t.id"
        class="her-note"
        :class="{ muted: t.hidden }"
      >
        <div class="note-index">{{ String(i + 1).padStart(2, "0") }}</div>
        <div>
          <header>
            <span
              >{{ data.kinds.thoughts[t.kind] || t.kind
              }}{{ t.parent_id ? " · 修正了以前的想法" : "" }}</span
            >
            <time>{{ when(t.created) }}</time>
          </header>
          <p>{{ t.content }}</p>
          <small v-if="t.status === 'resolved'" class="tag" data-kind="closed"
            >放下了{{ t.resolution ? `：${t.resolution}` : "" }}</small
          >
          <div v-if="t.outreach" class="outreach-draft">
            想主动说：{{ t.outreach }} ·
            {{
              {
                planned: "等合适的时候",
                sending: "正在发",
                sent: "说出口了",
                declined: "她后来决定不说",
                skipped: "时机不合适",
                cancelled: "没有发",
                uncertain: "投递未确认",
              }[t.outreach_status as string] || t.outreach_status
            }}
          </div>
          <footer>
            <button
              type="button"
              @click="
                update(t, { status: t.status === 'open' ? 'resolved' : 'open' })
              "
            >
              {{ t.status === "open" ? "放下这件事" : "重新关注" }}
            </button>
            <button type="button" @click="update(t, { hidden: !t.hidden })">
              {{ t.hidden ? "恢复" : "不再参与她的思考" }}
            </button>
            <button type="button" class="text-button" @click="remove(t)">
              删除
            </button>
          </footer>
        </div>
      </article>
      <div v-if="!life.thoughts.length" class="gentle-empty">
        <b>这页还没有字</b>
        <p>她只在有新的理解时才写，不为显得忙碌写流水账。</p>
      </div>
    </section>

    <section class="surface" style="grid-column: 1 / -1">
      <div class="section-heading">
        <div>
          <span class="eyebrow">WHEN NOBODY WAS TALKING</span>
          <h3>独处、日记与夜里的记录</h3>
        </div>
      </div>
      <div v-if="life.runs.length" class="run-list">
        <article v-for="r in life.runs" :key="r.id">
          <time>{{ when(r.started) }}</time>
          <span class="tag" :data-kind="r.status"
            >{{ RUN_KIND[r.kind] || r.kind }} ·
            {{ RUN[r.status] || r.status }}</span
          >
          <div>
            <b>{{ r.reason }}</b>
            <small
              >{{ r.model || "未调用模型" }} ·
              {{ Number(r.tokens || 0).toLocaleString() }} Token</small
            >
          </div>
        </article>
      </div>
      <p v-else class="gentle-empty">
        安静本身不会留下记录；她真正独处、写日记或在夜里整理时才会记下。
      </p>
    </section>
  </div>
  <div v-else class="empty-state">正在翻开她的日子…</div>
</template>
