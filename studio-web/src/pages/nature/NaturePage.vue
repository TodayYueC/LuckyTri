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
import Select from "../../components/ui/Select.vue";

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
const pending = reactive({ nature: false, days: false, prompts: false });
function saved(section: keyof typeof pending) {
  pending[section] = false;
  studio.dirty = Object.values(pending).some(Boolean);
}
const useDraft = ref(true);
const natureEdits = computed(() => {
  const latest = versions.value.reduce(
    (max, item) => Math.max(max, Number(item.version) || 0),
    0,
  );
  const used = latest <= 1 ? 0 : latest - 1;
  return { used, left: Math.max(0, 2 - used), locked: used >= 2 };
});

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
    gender: value.gender || "female",
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
    gender: nature.nature.gender || "female",
    interests: nature.nature.interests.join("，"),
    forbidden: nature.nature.forbidden.join("\n"),
    bottomLines: nature.nature.bottomLines.join("\n"),
  };
  versions.value = nature.versions;
  settings.life = { ...overview.life };
  settings.budget = { ...overview.budget.settings };
}

function dirty(section: keyof typeof pending = "nature") {
  pending[section] = true;
  studio.dirty = true;
}

async function saveNature() {
  if (busy.value) return;
  busy.value = true;
  try {
    await mind.saveNature(natureValue());
    if (aliases.value !== studio.health.settings.aliases)
      await patchSettings({ aliases: aliases.value });
    saved("nature");
    await reload();
    const current = await mind.nature();
    versions.value = current.versions;
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
    saved("days");
    toast("TA 的日子已按新设置安排");
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function savePrompts() {
  try {
    await mind.savePrompts({ ...prompts });
    saved("prompts");
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
    <section class="nature-intro" aria-label="天性预览">
      <div class="nature-intro-copy">
        <span class="eyebrow">THE WAY SHE GROWS · 天性</span>
        <h1>她的底色，<br /><em>慢慢长成她自己。</em></h1>
        <p>一些与生俱来的倾向，会在每一次相遇里长出新的模样。</p>
        <span class="nature-preview-note"><i></i> 调节刻度，看看此刻的她</span>
      </div>
      <div class="nature-intro-orb">
        <TaOrb
          class="preview-orb"
          :mood="liveMood"
          :traits="traits"
          :size="170"
          interactive
        />
      </div>
    </section>
    <div class="greenhouse">
      <section class="card editor">
        <form id="natureForm" @submit.prevent="saveNature" @input="dirty()">
          <p class="faint" role="status">
            {{
              natureEdits.locked
                ? "两次更改已经用完。之后的性格、兴趣和样子，由 TA 自己从经历里生长。"
                : `天性还可以改 ${natureEdits.left} 次，包括性格刻度。用完后由她自己生长。`
            }}
          </p>
          <header class="editor-head">
            <span class="eyebrow">塑造 TA</span>
            <h2>TA 生来是什么样的？</h2>
            <p class="muted">
              天性是种子：性格、兴趣和底线。TA
              的自我、在各群的样子、对每个人的感觉都会从经历里长出来——你能看到、能撤销，但不在这里改写。
            </p>
          </header>

          <fieldset class="nature-fields" :disabled="natureEdits.locked">
            <div class="form-grid">
              <label
                >名字<input
                  v-model="draft.name"
                  name="name"
                  required
                  maxlength="40"
              /></label>
              <label>
                性别
                <Select
                  v-model="draft.gender"
                  name="gender"
                  aria-label="性别"
                  :options="[
                    { value: 'female', label: '女' },
                    { value: 'male', label: '男' },
                    { value: 'unspecified', label: '不指定' },
                  ]"
                />
                <small
                  >人称会进入 TA 对自己的理解。女是「她」，男是「他」。</small
                >
              </label>
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
                  @update:sleep="dirty()"
                  @update:wake="dirty()"
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
            <button class="primary" :disabled="busy || natureEdits.locked">
              {{
                natureEdits.locked ? "已交给 TA" : busy ? "保存中…" : "保存天性"
              }}
            </button>
            <span class="faint" role="status">{{
              natureEdits.locked
                ? "更改次数已用完"
                : pending.nature
                  ? "天性有未保存的修改"
                  : `还可以改 ${natureEdits.left} 次`
            }}</span>
          </div>
        </form>
      </section>

      <aside class="side">
        <div class="card orb-card">
          <span class="eyebrow">调色盘 · 即时反馈</span>
          <h3>微小的倾向，也会改变表达</h3>
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
      @input="dirty('days')"
      @change="dirty('days')"
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
                >可以在自己待过、安静下来的地方考虑说一句，也可以在心里有具体的人和事时再联系。说不说由 TA 决定；冷的联系没有回应前不会再追。关掉之后就不再主动开口。</small>
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
          <p class="faint wide">
            独处、日记和夜里整理也使用模型库里的默认模型，不再单独指定。
          </p>
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
          <button class="primary" type="submit">保存 TA 的日子</button
          ><span class="faint" role="status">{{
            pending.days ? "日常安排有未保存的修改" : "日常安排已保存"
          }}</span>
        </div>
      </section>
    </form>

    <details class="card prompts">
      <summary><span class="eyebrow">高级</span><b>指令（Prompt）</b></summary>
      <form
        id="promptsForm"
        class="stack tight"
        @submit.prevent="savePrompts"
        @input="dirty('prompts')"
      >
        <label>
          要编辑的指令
          <Select
            v-model="promptKey"
            aria-label="要编辑的指令"
            :options="
              Object.keys(prompts).map((key) => ({
                value: key,
                label: PROMPT_NAMES[key] || key,
              }))
            "
          />
        </label>
        <label
          >指令正文<textarea
            v-model="prompts[promptKey]"
            rows="14"
            class="mono"
          ></textarea>
        </label>
        <div class="save-bar">
          <button class="primary">保存指令</button
          ><span class="faint" role="status">{{
            pending.prompts ? "指令有未保存的修改" : "指令已保存"
          }}</span>
        </div>
      </form>
    </details>
  </div>
</template>

<style scoped>
.nature {
  display: grid;
  gap: var(--gap);
}
.nature-intro {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.7fr);
  align-items: center;
  gap: 16px;
  min-height: 256px;
  padding: 34px clamp(30px, 5vw, 72px);
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.88);
  border-radius: 36px;
  background:
    radial-gradient(
      ellipse at 77% 37%,
      color-mix(in srgb, var(--orb-a) 76%, transparent),
      transparent 47%
    ),
    radial-gradient(
      ellipse at 13% 96%,
      color-mix(in srgb, var(--glow-b) 33%, transparent),
      transparent 48%
    ),
    linear-gradient(
      120deg,
      rgb(255 255 255 / 0.82),
      rgb(255 255 255 / 0.34) 62%,
      rgb(255 255 255 / 0.58)
    );
  box-shadow:
    inset 0 2px 0 white,
    inset 0 -1px 0 rgb(255 255 255 / 0.62),
    0 25px 60px -37px color-mix(in srgb, var(--accent) 44%, transparent);
  backdrop-filter: blur(26px) saturate(1.85);
}
.nature-intro::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -45% -15% auto 43%;
  height: 165%;
  border-radius: 46% 54% 64% 36%;
  background: conic-gradient(
    from 45deg,
    rgb(255 255 255 / 0.56),
    color-mix(in srgb, var(--glow-b) 42%, transparent),
    rgb(255 255 255 / 0.2),
    color-mix(in srgb, var(--orb-a) 45%, transparent),
    rgb(255 255 255 / 0.56)
  );
  filter: blur(22px);
  animation: nature-drift 10s ease-in-out infinite alternate;
}
.nature-intro-copy {
  position: relative;
  z-index: 1;
}
.nature-intro h1 {
  margin: 12px 0 8px;
  font-size: clamp(29px, 3.8vw, 49px);
  line-height: 1.13;
  letter-spacing: -0.065em;
}
.nature-intro h1 em {
  font-style: normal;
  background: linear-gradient(
    100deg,
    var(--accent),
    var(--orb-c) 58%,
    color-mix(in srgb, var(--glow-b) 54%, var(--accent))
  );
  color: transparent;
  background-clip: text;
}
.nature-intro-copy > p {
  max-width: 410px;
  color: var(--ink-soft);
  font-size: 14px;
}
.nature-preview-note {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-top: 22px;
  padding: 8px 13px;
  border: 1px solid rgb(255 255 255 / 0.85);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.42);
  box-shadow: inset 0 1px 0 white;
  color: var(--ink-soft);
  font-size: 12px;
  backdrop-filter: blur(12px);
}
.nature-preview-note i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--orb-b);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--orb-b) 22%, transparent);
  animation: pulse-soft 2.8s ease-in-out infinite;
}
.nature-intro-orb {
  position: relative;
  display: grid;
  place-items: center;
  justify-self: center;
  width: 225px;
  height: 225px;
  border-radius: 50%;
  background:
    radial-gradient(
      circle at 31% 25%,
      rgb(255 255 255 / 0.68),
      transparent 28%
    ),
    radial-gradient(
      circle,
      rgb(255 255 255 / 0.26) 38%,
      color-mix(in srgb, var(--orb-b) 20%, transparent) 56%,
      transparent 69%
    );
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.63),
    0 18px 52px -28px color-mix(in srgb, var(--orb-c) 74%, transparent);
  animation: nature-breathe 5s ease-in-out infinite;
}
.nature-intro-orb::before,
.nature-intro-orb::after {
  content: "";
  position: absolute;
  inset: -14px;
  border: 1px solid rgb(255 255 255 / 0.54);
  border-radius: 50%;
  pointer-events: none;
}
.nature-intro-orb::after {
  inset: -30px;
  border-color: color-mix(in srgb, var(--glow-b) 28%, transparent);
}
.nature-intro-orb :deep(.preview-orb) {
  filter: drop-shadow(
    0 13px 16px color-mix(in srgb, var(--orb-c) 27%, transparent)
  );
}
@keyframes nature-drift {
  to {
    transform: translate(-5%, 4%) rotate(16deg) scale(1.07);
  }
}
@keyframes nature-breathe {
  50% {
    transform: translateY(-8px) scale(1.025);
  }
}
.greenhouse {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
  gap: var(--gap);
  align-items: start;
}
.greenhouse > *,
.days > *,
.side,
fieldset {
  min-width: 0;
}
.save-bar {
  max-width: 100%;
}
.editor {
  background:
    radial-gradient(
      circle at 100% 0,
      color-mix(in srgb, var(--glow-a) 24%, transparent),
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
  padding: 18px;
  border: 1px solid rgb(255 255 255 / 0.78);
  border-radius: 24px;
  background:
    linear-gradient(150deg, rgb(255 255 255 / 0.64), rgb(255 255 255 / 0.24)),
    color-mix(in srgb, var(--surface) 70%, transparent);
  box-shadow:
    inset 0 1px 0 white,
    0 11px 28px -24px var(--accent);
  backdrop-filter: blur(20px) saturate(1.55);
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
  padding: 9px 10px;
  border-radius: 15px;
  transition:
    transform 0.32s var(--spring),
    background-color 0.25s;
}
.trait:hover {
  transform: translateX(3px);
  background: rgb(255 255 255 / 0.47);
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
  border-radius: 999px;
}
.trait input[type="range"] {
  appearance: none;
  height: 11px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--glow-b) 43%, white),
    color-mix(in srgb, var(--orb-b) 58%, white)
  );
  box-shadow:
    inset 0 1px 3px color-mix(in srgb, var(--accent) 14%, transparent),
    0 1px 0 white;
}
.trait input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 22px;
  height: 22px;
  border: 3px solid white;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 3px 10px -3px var(--accent);
  transition: transform 0.25s var(--spring);
}
.trait input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
.trait input[type="range"]::-moz-range-thumb {
  width: 17px;
  height: 17px;
  border: 3px solid white;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 3px 10px -3px var(--accent);
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
  border-radius: 14px;
  background: var(--surface-strong);
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
  justify-items: start;
  gap: 10px;
  background:
    radial-gradient(
      circle at 50% 42%,
      color-mix(in srgb, var(--glow-a) 80%, transparent),
      transparent 62%
    ),
    var(--surface);
}
.orb-card h3 {
  font-size: 18px;
}
.effects {
  display: grid;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
}
.effects li {
  display: grid;
  grid-template-columns: minmax(74px, auto) minmax(0, 1fr);
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid rgb(255 255 255 / 0.74);
  border-radius: 14px;
  background: rgb(255 255 255 / 0.4);
  box-shadow: inset 0 1px 0 white;
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
  padding: 13px 14px;
  border: 1px solid rgb(255 255 255 / 0.78);
  border-radius: 18px;
  background: rgb(255 255 255 / 0.42);
  box-shadow: inset 0 1px 0 white;
  transition:
    transform 0.33s var(--spring),
    background-color 0.2s;
}
.toggles .switch:hover {
  transform: translateX(4px);
  background: rgb(255 255 255 / 0.67);
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
  .nature-intro {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    padding: 26px;
    text-align: center;
  }
  .nature-intro-orb {
    width: 176px;
    height: 176px;
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
