<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { toast } from "../../api";
import { reload, studio } from "../../stores/studio";
import { patchSettings } from "../../plates/workspace";
import { mind, when } from "../../plates/mind";
import { liveMood } from "../../mood/useMood";
import TaOrb from "../../components/ta/TaOrb.vue";
import TaChat from "../../components/ta/TaChat.vue";
import Card from "../../components/ui/Card.vue";
import RhythmClock from "./RhythmClock.vue";

const TRAITS = [
  {
    key: "warmth",
    label: "温柔",
    low: "颜色偏冷，表情淡淡的",
    high: "颜色更暖，嘴角上扬",
  },
  { key: "sarcasm", label: "毒舌", low: "不挖苦人", high: "嘴角一歪，会吐槽" },
  { key: "humor", label: "幽默", low: "认真", high: "眯眼笑，爱开玩笑" },
  { key: "activity", label: "活泼", low: "安安静静", high: "跳得更快" },
  { key: "initiative", label: "主动", low: "等别人先开口", high: "身子往前探" },
] as const;
const PROMPT_NAMES: Record<string, string> = {
  system: "系统指令",
  turn: "看见与开口",
  generation: "重新措辞",
  validation: "回复检查",
  memory: "记忆整理",
  vision: "图片理解",
  summary: "上下文压缩",
  summaryMerge: "摘要合并",
  reflection: "独处",
  daily: "日记",
};

const draft = ref<any>(null);
const aliases = ref(String(studio.health.settings.aliases || ""));
const versions = ref<any[]>([]);
const settings = reactive<any>({ life: null, budget: null });
const prompts = reactive({ ...studio.core.prompts });
const promptKey = ref("turn");
const busy = ref(false);
const useDraft = ref(true);

const traits = computed(() =>
  draft.value
    ? Object.fromEntries(
        TRAITS.map((t) => [t.key, Number(draft.value[t.key]) || 0]),
      )
    : null,
);

const list = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String)
    : String(value || "")
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

function natureValue() {
  const { version: _version, ...value } = draft.value;
  return {
    ...value,
    interests: list(value.interests),
    forbidden: list(value.forbidden),
    bottomLines: list(value.bottomLines),
  };
}
const previewNature = computed(() =>
  useDraft.value && draft.value ? natureValue() : null,
);

function describe(t: (typeof TRAITS)[number]) {
  return (Number(draft.value?.[t.key]) || 0) >= 50 ? t.high : t.low;
}

async function load() {
  const [nature, overview] = await Promise.all([
    mind.nature(),
    mind.overview(),
  ]);
  draft.value = {
    ...nature.nature,
    interests: nature.nature.interests.join("，"),
    forbidden: nature.nature.forbidden.join("\n"),
    bottomLines: nature.nature.bottomLines.join("\n"),
  };
  versions.value = nature.versions;
  settings.life = { ...overview.life };
  settings.budget = { ...overview.budget.settings };
}

function dirty() {
  studio.dirty = true;
}

async function saveNature() {
  if (busy.value) return;
  busy.value = true;
  try {
    await mind.saveNature(natureValue());
    if (aliases.value !== studio.health.settings.aliases)
      await patchSettings({ aliases: aliases.value });
    studio.dirty = false;
    await reload();
    await load();
    toast("天性已保存，下一次开口时生效");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function saveSettings() {
  try {
    const result = await mind.saveSettings({
      life: settings.life,
      budget: {
        dailyTokens: Number(settings.budget.dailyTokens) || 0,
        innerShare: Number(settings.budget.innerShare),
        upkeepShare: Number(settings.budget.upkeepShare),
      },
    });
    settings.life = { ...result.life };
    settings.budget = { ...result.budget };
    studio.dirty = false;
    toast("TA 的日子已按新设置安排");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function savePrompts() {
  try {
    await mind.savePrompts({ ...prompts });
    studio.dirty = false;
    await reload();
    toast("指令已保存，下一轮生效");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

onMounted(load);
</script>

<template>
  <div v-if="draft" class="page nature">
    <div class="greenhouse">
      <section class="card editor">
        <form id="natureForm" @submit.prevent="saveNature" @input="dirty">
          <header class="editor-head">
            <span class="eyebrow">塑造 TA</span>
            <h2>TA 生来是什么样的？</h2>
            <p class="muted">
              天性是种子：性格、兴趣和底线。TA
              的自我、在各群的样子、对每个人的感觉都会从经历里长出来——你能看到、能撤销，但不在这里改写。
            </p>
          </header>

          <div class="form-grid">
            <label
              >名字<input
                v-model="draft.name"
                name="name"
                required
                maxlength="40"
            /></label>
            <label>
              别人会怎么叫 TA
              <input
                v-model="aliases"
                name="aliases"
                placeholder="用逗号分隔"
              />
              <small>群友叫 TA 的称呼，保存时一并写进全局设置</small>
            </label>
            <label class="wide">
              天性
              <textarea
                v-model="draft.base"
                name="base"
                rows="6"
                placeholder="TA 的背景、性格、兴趣和社交方式…"
              ></textarea>
            </label>
          </div>

          <fieldset class="traits">
            <legend>性格刻度</legend>
            <div v-for="t in TRAITS" :key="t.key" class="trait">
              <div class="trait-head">
                <b>{{ t.label }}</b>
                <small class="muted">{{ describe(t) }}</small>
              </div>
              <input
                v-model.number="draft[t.key]"
                type="range"
                min="0"
                max="100"
                :data-trait="t.key"
                :aria-label="`${t.label}刻度`"
              />
              <input
                v-model.number="draft[t.key]"
                :name="t.key"
                type="number"
                min="0"
                max="100"
                class="trait-number"
                :aria-label="t.label"
              />
            </div>
            <label
              >说话长度<input v-model="draft.length" name="length"
            /></label>
          </fieldset>

          <fieldset class="rhythm-set">
            <legend>作息</legend>
            <label class="switch">
              <input
                v-model="draft.rhythm.enabled"
                type="checkbox"
                name="rhythmEnabled"
              />
              <span
                >TA 会睡觉：睡着时不看群，被私聊或 @
                会等醒来再看（危机消息除外）</span
              >
            </label>
            <div class="rhythm-row">
              <RhythmClock
                v-model:sleep="draft.rhythm.sleep"
                v-model:wake="draft.rhythm.wake"
                :disabled="!draft.rhythm.enabled"
                @update:sleep="dirty"
                @update:wake="dirty"
              />
              <div class="stack tight times">
                <label
                  >几点睡<input
                    v-model="draft.rhythm.sleep"
                    type="time"
                    name="sleep"
                    step="900"
                /></label>
                <label
                  >几点醒<input
                    v-model="draft.rhythm.wake"
                    type="time"
                    name="wake"
                    step="900"
                /></label>
                <small class="faint">拖动月亮和太阳，或直接输入时间。</small>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>兴趣、边界与底线</legend>
            <div class="stack tight">
              <label
                >兴趣<input
                  v-model="draft.interests"
                  name="interests"
                  placeholder="用逗号分隔"
              /></label>
              <label
                >社交边界<input v-model="draft.boundaries" name="boundaries"
              /></label>
              <label
                >底线（每行一条）<textarea
                  v-model="draft.bottomLines"
                  name="bottomLines"
                  rows="4"
                ></textarea>
              </label>
              <label
                >不想用的说法（每行一个）<textarea
                  v-model="draft.forbidden"
                  name="forbidden"
                  rows="3"
                ></textarea>
              </label>
              <small class="faint"
                >凭据（密码、密钥、验证码）永远不会进入 TA
                的心智，这一条写死在代码里。</small
              >
            </div>
          </fieldset>

          <details class="versions">
            <summary>天性的版本 · {{ versions.length }}</summary>
            <ol>
              <li v-for="v in versions" :key="v.version">
                <span class="chip" data-tone="quiet"
                  >第 {{ v.version }} 版</span
                >
                <span>{{ v.note || "修改" }}</span>
                <time class="faint">{{ when(v.created) }}</time>
              </li>
            </ol>
          </details>

          <div class="save-bar">
            <button class="primary" :disabled="busy">
              {{ busy ? "保存中…" : "保存天性" }}
            </button>
            <span class="faint">保存为新的一版，旧版本保留</span>
          </div>
        </form>
      </section>

      <aside class="side">
        <div class="card orb-card">
          <span class="eyebrow">拖动刻度，看看 TA</span>
          <TaOrb
            class="preview-orb"
            :mood="liveMood"
            :traits="traits"
            :size="170"
            interactive
          />
          <ul class="effects">
            <li v-for="t in TRAITS" :key="t.key">
              <b>{{ t.label }} {{ draft[t.key] }}</b>
              <span>{{ describe(t) }}</span>
            </li>
          </ul>
        </div>
        <Card class="chat-card" title="用草稿天性试聊" eyebrow="TALK TO TA">
          <TaChat
            anchored
            :sessions="studio.core.sessions"
            :nature="previewNature"
            starter="今天真的好累啊"
          >
            <template #options>
              <label class="check"
                ><input
                  v-model="useDraft"
                  type="checkbox"
                />用左边还没保存的天性</label
              >
            </template>
          </TaChat>
        </Card>
      </aside>
    </div>

    <form
      v-if="settings.life"
      class="days"
      @submit.prevent="saveSettings"
      @input="dirty"
      @change="dirty"
    >
      <section class="card">
        <div class="card-head">
          <div>
            <span class="eyebrow">TA 的日子</span>
            <h2>TA 怎样度过没人说话的时间</h2>
          </div>
        </div>
        <div class="toggles">
          <label class="switch"
            ><input v-model="settings.life.solitude" type="checkbox" /><span
              ><b>独处</b
              ><small
                >聊天安静下来后，TA
                会重新看看最近的事，改变对自己、对人的理解。</small
              ></span
            ></label
          >
          <label class="switch"
            ><input v-model="settings.life.reading" type="checkbox" /><span
              ><b>独处时读资料</b
              ><small
                >从共享资料里按自己的兴趣挑着读，一段一段读下去；读过的内容聊天时可以自然提起。</small
              ></span
            ></label
          >
          <label class="switch"
            ><input v-model="settings.life.diary" type="checkbox" /><span
              ><b>睡前写日记</b
              ><small
                >一天结束时写下这一天，和昨天的自己对照；隔一段时间在夜里回顾，改写自传、翻开新的一章。</small
              ></span
            ></label
          >
          <label class="switch"
            ><input v-model="settings.life.night" type="checkbox" /><span
              ><b>夜里整理</b
              ><small
                >睡着以后，把白天没整理的聊天记进记忆和约定里，再按回顾间隔回顾这段日子。</small
              ></span
            ></label
          >
          <label class="switch"
            ><input v-model="settings.life.proactive" type="checkbox" /><span
              ><b>允许 TA 主动说话</b
              ><small
                >只在 TA 心里有具体的人和事、对话已经安静、TA
                醒着时才会考虑；说不说由 TA 决定，没有回应前不会再追。</small
              ></span
            ></label
          >
        </div>
        <div class="form-grid">
          <label
            >安静多久才独处（分钟）<input
              v-model.number="settings.life.idleMinutes"
              type="number"
              min="0"
          /></label>
          <label
            >两次独处至少间隔（分钟）<input
              v-model.number="settings.life.intervalMinutes"
              type="number"
              min="10"
          /></label>
          <label
            >攒够多少条新消息（条）<input
              v-model.number="settings.life.minMessages"
              type="number"
              min="0"
          /></label>
          <label
            >回顾间隔（天）<input
              v-model.number="settings.life.chapterDays"
              type="number"
              min="1"
          /></label>
          <label
            >两次主动联系至少间隔（小时）<input
              v-model.number="settings.life.proactiveIntervalHours"
              type="number"
              min="1"
          /></label>
          <label>
            独处用的模型
            <select v-model="settings.life.modelId">
              <option value="">默认模型</option>
              <option v-for="m in studio.core.models" :key="m.id" :value="m.id">
                {{ m.label || m.model }}
              </option>
            </select>
          </label>
          <label
            >时区<input
              v-model="settings.life.timeZone"
              placeholder="Asia/Shanghai"
          /></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <div>
            <span class="eyebrow">每日注意力</span>
            <h2>TA 一天能花多少 Token</h2>
          </div>
        </div>
        <div class="form-grid">
          <label class="wide">
            每日 Token 上限（0 = 不限）
            <input
              v-model.number="settings.budget.dailyTokens"
              type="number"
              min="0"
            />
            <small
              >滚动 24 小时计算。快用完时，TA
              在群里只在被叫到时细看；用完后后台独处和整理暂停。</small
            >
          </label>
          <label
            >独处与日记最多占<input
              v-model.number="settings.budget.innerShare"
              type="number"
              min="0"
              max="0.9"
              step="0.05"
          /></label>
          <label
            >记忆整理与压缩最多占<input
              v-model.number="settings.budget.upkeepShare"
              type="number"
              min="0"
              max="0.9"
              step="0.05"
          /></label>
        </div>
        <p class="faint budget-note">
          扫一眼群聊不花 Token；TA
          细看时一次调用同时完成理解、心情和回复。私聊和 @ 永远优先。
        </p>
        <div class="save-bar">
          <button class="primary" type="submit">保存 TA 的日子</button>
        </div>
      </section>
    </form>

    <details class="card prompts">
      <summary><span class="eyebrow">高级</span><b>指令（Prompt）</b></summary>
      <form
        id="promptsForm"
        class="stack tight"
        @submit.prevent="savePrompts"
        @input="dirty"
      >
        <label>
          要编辑的指令
          <select v-model="promptKey">
            <option v-for="(_, key) in prompts" :key="key" :value="key">
              {{ PROMPT_NAMES[key] || key }}
            </option>
          </select>
        </label>
        <label
          >指令正文<textarea
            v-model="prompts[promptKey]"
            rows="14"
            class="mono"
          ></textarea>
        </label>
        <div class="save-bar"><button class="primary">保存指令</button></div>
      </form>
    </details>
  </div>
</template>

<style scoped>
.nature {
  display: grid;
  gap: var(--gap);
}
.greenhouse {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
  gap: var(--gap);
  align-items: start;
}
.editor {
  background:
    radial-gradient(
      circle at 100% 0,
      color-mix(in srgb, var(--glow-a) 55%, transparent),
      transparent 45%
    ),
    var(--surface);
}
#natureForm {
  display: grid;
  gap: 18px;
}
.editor-head h2 {
  font-size: 21px;
}
.editor-head p {
  margin-top: 6px;
  font-size: 13px;
}
fieldset {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-strong) 55%, transparent);
}
legend {
  padding: 0 8px;
  font-weight: 700;
  font-size: 13px;
}
.trait {
  display: grid;
  grid-template-columns: minmax(130px, 0.9fr) minmax(0, 1.6fr) 64px;
  align-items: center;
  gap: 12px;
}
.trait-head {
  display: grid;
  line-height: 1.3;
}
.trait-head small {
  font-size: 11.5px;
}
.trait-number {
  padding: 6px 8px;
  text-align: center;
}
.rhythm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
}
.times {
  flex: 1 1 160px;
}
.versions summary {
  font-weight: 600;
  color: var(--accent);
}
.versions ol {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.versions li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.save-bar {
  position: sticky;
  bottom: 12px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-strong) 88%, transparent);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(10px);
}
.side {
  position: sticky;
  top: 16px;
  display: grid;
  gap: var(--gap);
}
.orb-card {
  display: grid;
  justify-items: center;
  gap: 10px;
  background:
    radial-gradient(
      circle at 50% 42%,
      color-mix(in srgb, var(--glow-a) 80%, transparent),
      transparent 62%
    ),
    var(--surface);
}
.effects {
  display: grid;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
}
.effects li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.effects span {
  color: var(--ink-soft);
}
.chat-card :deep(.ta-chat) {
  height: 460px;
}
.days {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}
.toggles {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}
.toggles .switch {
  align-items: flex-start;
}
.toggles .switch span {
  display: grid;
  gap: 2px;
}
.toggles small {
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 400;
}
.budget-note {
  margin: 12px 0;
}
.prompts summary {
  display: grid;
  gap: 2px;
}
.prompts[open] summary {
  margin-bottom: 14px;
}
.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}
@media (max-width: 1100px) {
  .greenhouse,
  .days {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    position: static;
  }
}
@media (max-width: 760px) {
  .trait {
    grid-template-columns: minmax(0, 1fr) 64px;
  }
  .trait-head {
    grid-column: 1 / -1;
  }
}
</style>
