<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { toast } from "../../api";
import { studio, reload } from "../../store";
import { patchSettings } from "../../plates/workspace";
import { CHOICE_LABELS, mind, when } from "../../plates/mind";

defineProps<{ data: any }>();
const emit = defineEmits<{ changed: [] }>();
const TRAITS = {
  warmth: "温柔",
  sarcasm: "毒舌",
  humor: "幽默",
  activity: "活泼",
  initiative: "主动",
} as const;
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
const history = ref<{ role: string; text: string; note?: string }[]>([]);
const text = ref("今天真的好累啊");
const useDraft = ref(true);
const viewSession = ref("");
const previewing = ref(false);
const meta = ref(
  "试聊走真实链路：读取她此刻的心智和记忆，但不写入，也不发 QQ。",
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
async function saveNature(e: Event) {
  e.preventDefault();
  if (busy.value) return;
  busy.value = true;
  try {
    await mind.saveNature(natureValue());
    if (aliases.value !== studio.health.settings.aliases)
      await patchSettings({ aliases: aliases.value });
    studio.dirty = false;
    await reload();
    await load();
    emit("changed");
    toast("天性已保存，下一次开口时生效");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function saveSettings(e: Event) {
  e.preventDefault();
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
    emit("changed");
    toast("她的日子已按新设置安排");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function savePrompts(e: Event) {
  e.preventDefault();
  try {
    await mind.savePrompts({ ...prompts });
    studio.dirty = false;
    await reload();
    toast("Prompt 已保存，下一轮生效");
  } catch (error) {
    toast((error as Error).message, true);
  }
}
async function preview(e: Event) {
  e.preventDefault();
  if (previewing.value || !text.value.trim()) return;
  previewing.value = true;
  const said = text.value.trim();
  try {
    const r = await mind.preview({
      text: said,
      history: history.value.map(({ role, text }) => ({ role, text })),
      ...(useDraft.value ? { nature: natureValue() } : {}),
      viewSession: viewSession.value,
    });
    history.value.push({ role: "user", text: said });
    if (r.reply)
      history.value.push({
        role: "assistant",
        text: r.reply,
        note: `${CHOICE_LABELS[r.choice] || r.choice}${r.appraisal ? ` · ${r.appraisal}` : ""}`,
      });
    else
      history.value.push({
        role: "assistant",
        text: "（她没有出声）",
        note: r.reason,
      });
    text.value = "";
    meta.value = `${r.mode === "model" ? "真实模型" : "本地样例（没有模型档案）"} · 心情${r.mood || "平静"} · ${r.latency} ms`;
  } catch (error) {
    meta.value = (error as Error).message;
  } finally {
    previewing.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div v-if="draft" class="persona-workbench">
    <section class="persona-editor surface">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">NATURE / 只有这里由你来写</span>
          <h2>她生来是什么样的人？</h2>
        </div>
        <span class="persona-emblem" aria-hidden="true">✦</span>
      </div>
      <form id="natureForm" @submit="saveNature" @input="dirty">
        <div class="form-scroll">
          <p class="small">
            天性是种子：性格、兴趣和底线。她的自我、在各群的样子、对每个人的感觉都会从经历里长出来——你能看到、能撤销，但不在这里改写。
          </p>
          <div class="grid">
            <label
              >名字<input
                v-model="draft.name"
                name="name"
                required
                maxlength="40"
            /></label>
            <label
              >别人会怎么叫她<input
                v-model="aliases"
                name="aliases"
                placeholder="用逗号分隔"
            /></label>
          </div>
          <label
            >天性<textarea
              v-model="draft.base"
              name="base"
              class="persona-text"
              placeholder="她的背景、性格、兴趣和社交方式…"
            ></textarea>
          </label>
          <fieldset>
            <legend>性格刻度</legend>
            <div class="trait-grid">
              <label v-for="(label, key) in TRAITS" :key="key"
                ><span
                  >{{ label }}<b>{{ draft[key] }}</b></span
                ><input
                  :name="key"
                  type="number"
                  min="0"
                  max="100"
                  v-model.number="draft[key]" /></label
              ><label
                ><span>说话长度</span
                ><input name="length" v-model="draft.length"
              /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>作息</legend>
            <label class="check"
              ><input
                type="checkbox"
                name="rhythmEnabled"
                v-model="draft.rhythm.enabled"
              />她会睡觉：睡着时不看群，被私聊或 @
              会等醒来再看（危机消息除外）</label
            >
            <div class="grid">
              <label
                >几点睡<input
                  type="time"
                  name="sleep"
                  v-model="draft.rhythm.sleep"
              /></label>
              <label
                >几点醒<input
                  type="time"
                  name="wake"
                  v-model="draft.rhythm.wake"
              /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>兴趣、边界与底线</legend>
            <label
              >兴趣<input
                name="interests"
                v-model="draft.interests"
                placeholder="用逗号分隔"
            /></label>
            <label
              >社交边界<input name="boundaries" v-model="draft.boundaries"
            /></label>
            <label
              >底线（每行一条）<textarea
                name="bottomLines"
                v-model="draft.bottomLines"
              ></textarea>
            </label>
            <label
              >不想用的说法（每行一个）<textarea
                name="forbidden"
                v-model="draft.forbidden"
              ></textarea>
            </label>
            <small
              >凭据（密码、密钥、验证码）永远不会进入她的心智，这一条写死在代码里。</small
            >
          </fieldset>
          <details>
            <summary>天性的版本 · {{ versions.length }}</summary>
            <div class="row-list">
              <article v-for="v in versions" :key="v.version">
                <time>{{ when(v.created) }}</time>
                <span class="tag">第 {{ v.version }} 版</span>
                <p>{{ v.note || "修改" }}</p>
              </article>
            </div>
          </details>
        </div>
        <div class="action-bar">
          <button class="primary" :disabled="busy">
            {{ busy ? "保存中…" : "保存天性 ↗" }}</button
          ><span class="small">保存为新的一版，旧版本保留</span>
        </div>
      </form>
    </section>
    <aside class="voice-preview surface" id="her-preview">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">TALK TO HER</span>
          <h2>和此刻的她说一句</h2>
        </div>
        <button type="button" @click="history = []">清空</button>
      </div>
      <div class="small preview-meta">{{ meta }}</div>
      <div id="previewMessages" class="scroll-pane">
        <article
          v-for="(m, i) in history"
          :key="i"
          class="message preview-bubble"
          :class="{
            reply: m.role === 'assistant',
            bot: m.role === 'assistant',
          }"
        >
          <p>{{ m.text }}</p>
          <small v-if="m.note">{{ m.note }}</small>
        </article>
        <div v-if="!history.length" class="empty-state">
          <span>“</span>
          <h3>她会先理解，再决定说不说</h3>
          <p>回应会显示她的选择和当时的想法。</p>
        </div>
      </div>
      <form id="previewForm" @submit="preview">
        <label
          >想象在这里<select v-model="viewSession" name="viewSession">
            <option value="">一段新的私聊</option>
            <option v-for="s in studio.core.sessions" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select></label
        >
        <label class="check"
          ><input
            type="checkbox"
            v-model="useDraft"
          />用左边还没保存的天性</label
        >
        <div class="composer">
          <input
            name="text"
            v-model="text"
            placeholder="说一句试试…"
            required
          /><button class="primary" :disabled="previewing">
            {{ previewing ? "她在想…" : "说 ↗" }}
          </button>
        </div>
      </form>
    </aside>
  </div>

  <form
    v-if="settings.life"
    class="settings-grid"
    @submit="saveSettings"
    @input="dirty"
    @change="dirty"
  >
    <section class="surface setting-card">
      <span class="setting-number">01</span>
      <div class="section-heading">
        <div>
          <span class="eyebrow">HER DAYS</span>
          <h3>她怎样度过没人说话的时间</h3>
        </div>
      </div>
      <label class="setting-toggle"
        ><input type="checkbox" v-model="settings.life.solitude" /><span
          ><b>独处</b
          ><small
            >聊天安静下来后，她会重新看看最近的事，改变对自己、对人的理解。</small
          ></span
        ></label
      >
      <label class="setting-toggle"
        ><input type="checkbox" v-model="settings.life.reading" /><span
          ><b>独处时读资料</b
          ><small
            >从共享知识库里按自己的兴趣挑着读，一段一段读下去；读过的内容聊天时可以自然提起。</small
          ></span
        ></label
      >
      <label class="setting-toggle"
        ><input type="checkbox" v-model="settings.life.diary" /><span
          ><b>睡前写日记</b
          ><small
            >一天结束时写下这一天，和昨天的自己对照，隔一段时间重写自传。</small
          ></span
        ></label
      >
      <label class="setting-toggle"
        ><input type="checkbox" v-model="settings.life.proactive" /><span
          ><b>允许她主动说话</b
          ><small
            >只在她心里有具体的人和事、对话已经安静、她醒着时才会考虑；说不说由她决定，没有回应前不会再追。</small
          ></span
        ></label
      >
      <div class="field-grid">
        <label
          >安静多久才独处（分钟）<input
            type="number"
            min="0"
            v-model.number="settings.life.idleMinutes"
        /></label>
        <label
          >两次独处至少间隔（分钟）<input
            type="number"
            min="10"
            v-model.number="settings.life.intervalMinutes"
        /></label>
        <label
          >攒够多少条新消息（条）<input
            type="number"
            min="0"
            v-model.number="settings.life.minMessages"
        /></label>
        <label
          >自传多久重写一章（天）<input
            type="number"
            min="1"
            v-model.number="settings.life.chapterDays"
        /></label>
        <label
          >两次主动联系至少间隔（小时）<input
            type="number"
            min="1"
            v-model.number="settings.life.proactiveIntervalHours"
        /></label>
        <label
          >独处用的模型<select v-model="settings.life.modelId">
            <option value="">默认模型</option>
            <option v-for="m in studio.core.models" :key="m.id" :value="m.id">
              {{ m.label || m.model }}
            </option>
          </select></label
        >
        <label
          >时区<input
            v-model="settings.life.timeZone"
            placeholder="Asia/Shanghai"
        /></label>
      </div>
    </section>
    <section class="surface setting-card">
      <span class="setting-number">02</span>
      <div class="section-heading">
        <div>
          <span class="eyebrow">TOKEN BUDGET</span>
          <h3>她一天能花多少注意力</h3>
        </div>
      </div>
      <label
        >每日 Token 上限（0 = 不限）<input
          type="number"
          min="0"
          v-model.number="settings.budget.dailyTokens"
        /><small
          >滚动 24
          小时计算。快用完时，她在群里只在被叫到时细看；用完后后台独处和整理暂停。</small
        ></label
      >
      <div class="field-grid">
        <label
          >独处与日记最多占<input
            type="number"
            min="0"
            max="0.9"
            step="0.05"
            v-model.number="settings.budget.innerShare"
        /></label>
        <label
          >记忆整理与压缩最多占<input
            type="number"
            min="0"
            max="0.9"
            step="0.05"
            v-model.number="settings.budget.upkeepShare"
        /></label>
      </div>
      <p class="setting-note">
        扫一眼群聊不花 Token；她细看时一次调用同时完成理解、心情和回复。私聊和 @
        永远优先。
      </p>
      <div class="action-bar">
        <button class="primary" type="submit">保存她的日子 ↗</button>
      </div>
    </section>
  </form>

  <details class="surface">
    <summary>高级：Prompt</summary>
    <form id="promptsForm" @submit="savePrompts" @input="dirty">
      <label
        >要编辑的指令<select v-model="promptKey">
          <option v-for="(_, key) in prompts" :key="key" :value="key">
            {{ PROMPT_NAMES[key] || key }}
          </option>
        </select></label
      ><label
        >指令正文<textarea
          class="editor prompt-editor"
          v-model="prompts[promptKey]"
        ></textarea>
      </label>
      <div class="action-bar">
        <button class="primary">保存 Prompt ↗</button>
      </div>
    </form>
  </details>
</template>
