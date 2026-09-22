<script setup lang="ts">
import { reactive, ref } from "vue";
import { studio, reload } from "../store";
import { toast } from "../api";
import {
  savePersona as putPersona,
  savePrompts as putPrompts,
  previewVoice,
} from "../plates/character";
import { patchSettings } from "../plates/workspace";

const busy = ref(false);
const previewBusy = ref(false);
const editorTab = ref("identity");
const promptKey = ref("system");
const p = reactive({ ...studio.core.persona });
const settings = reactive({ ...studio.health.settings });
const history = ref<{ role: string; text: string }[]>([]);
const voiceText = ref("Lucky，今天真的好难过");
const voiceMeta = ref(
  "规则样例不读取自定义人格；真实模型试聊使用当前人格草稿，保存后才应用到 QQ。",
);
const useModel = ref(false);
const styleSession = ref("");
const prompts = reactive({ ...studio.core.prompts });
promptKey.value = Object.keys(prompts)[0] || "system";

function markDirty() {
  studio.dirty = true;
}

async function savePersona(e: Event) {
  e.preventDefault();
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.map(String)
      : String(value || "")
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
  if (busy.value) return;
  busy.value = true;
  try {
    await putPersona({
      ...p,
      interests: list(p.interests),
      forbidden: list(p.forbidden),
    });
    await patchSettings({
      persona: p.base,
      voicePreset: settings.voicePreset,
      slangLevel: Number(settings.slangLevel),
      cooldown: Number(settings.cooldown),
      probability: Number(settings.probability),
      contextLimit: Number(settings.contextLimit),
      maxReply: Number(settings.maxReply),
      allowMildProfanity: !!settings.allowMildProfanity,
      qualityRewrite: !!settings.qualityRewrite,
      adaptGroupStyle: !!settings.adaptGroupStyle,
    });
    studio.dirty = false;
    await reload();
    settings.persona = p.base;
    toast("已保存并应用");
  } finally {
    busy.value = false;
  }
}

async function savePrompts(e: Event) {
  e.preventDefault();
  await putPrompts({ ...prompts });
  studio.dirty = false;
  toast("Prompt 已保存，下一轮生效");
}

async function preview(e: Event) {
  e.preventDefault();
  if (previewBusy.value) return;
  previewBusy.value = true;
  try {
    const r = await previewVoice({
      text: voiceText.value,
      useModel: useModel.value,
      styleSession: styleSession.value,
      persona: p.base,
      history: history.value,
    });
    if (r.speak && r.reply)
      history.value.push(
        { role: "user", text: voiceText.value },
        { role: "assistant", text: r.reply },
      );
    voiceMeta.value = `${r.mode === "model" ? "真实模型" : "规则样例（非模型）"} · ${r.emotion} · ${r.latency} ms${r.speak ? "" : " · " + r.reason}`;
  } catch (err) {
    voiceMeta.value = (err as Error).message;
  } finally {
    previewBusy.value = false;
  }
}

function clearVoice() {
  history.value = [];
}
</script>

<template>
  <div class="persona-workbench">
    <section class="persona-editor surface" id="persona">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">PERSONA / DESIGN YOUR CHARACTER</span>
          <h2>她是什么样的人？</h2>
        </div>
        <span class="persona-emblem" aria-hidden="true">✦</span>
      </div>
      <div class="segment-tabs">
        <button
          :class="{ active: editorTab === 'identity' }"
          @click="editorTab = 'identity'"
        >
          人格与表达</button
        ><button
          :class="{ active: editorTab === 'prompts' }"
          @click="editorTab = 'prompts'"
        >
          高级 Prompt
        </button>
      </div>
      <form
        v-show="editorTab === 'identity'"
        id="personaForm"
        @submit="savePersona"
        @input="markDirty"
      >
        <div class="form-scroll">
          <div class="grid">
            <label>名字<input v-model="p.name" name="name" /></label
            ><label>当前情绪<input v-model="p.mood" name="mood" /></label>
          </div>
          <label
            >核心人设<textarea
              name="persona"
              v-model="p.base"
              class="persona-text"
              placeholder="她的背景、性格、兴趣和社交边界…"
            ></textarea
            ><small>聊天与右侧真实模型试聊使用同一份人设。</small></label
          >
          <fieldset>
            <legend>性格刻度</legend>
            <div class="trait-grid">
              <label
                v-for="(label, key) in {
                  warmth: '温柔',
                  sarcasm: '毒舌',
                  humor: '幽默',
                  activity: '活泼',
                  initiative: '主动',
                }"
                :key="key"
                ><span
                  >{{ label }}<b>{{ p[key] }}</b></span
                ><input
                  :name="key"
                  type="number"
                  min="0"
                  max="100"
                  v-model.number="p[key]" /></label
              ><label
                ><span>说话长度</span><input name="length" v-model="p.length"
              /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>表达习惯</legend>
            <div class="preset-grid">
              <label
                v-for="preset in studio.health.voice.presets"
                :key="preset.id"
                class="voice-preset"
                :class="{ picked: settings.voicePreset === preset.id }"
                ><input
                  type="radio"
                  name="voicePreset"
                  :value="preset.id"
                  v-model="settings.voicePreset"
                />{{ preset.name }}</label
              >
            </div>
            <div class="grid">
              <label
                >网络用语<input
                  name="slangLevel"
                  type="range"
                  min="0"
                  max="2"
                  v-model.number="settings.slangLevel" /></label
              ><label
                >默认冷却（秒）<input
                  name="cooldown"
                  type="number"
                  v-model.number="settings.cooldown" /></label
              ><label
                >默认参与概率<input
                  name="probability"
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  v-model.number="settings.probability"
              /></label>
            </div>
            <label class="check"
              ><input
                name="allowMildProfanity"
                type="checkbox"
                v-model="settings.allowMildProfanity"
              />允许轻度脏话</label
            ><label class="check"
              ><input
                name="adaptGroupStyle"
                type="checkbox"
                v-model="settings.adaptGroupStyle"
              />参考群友的沟通习惯</label
            ><label class="check"
              ><input
                name="qualityRewrite"
                type="checkbox"
                v-model="settings.qualityRewrite"
              />对不自然的回复进行修正</label
            >
          </fieldset>
          <fieldset>
            <legend>兴趣与社交边界</legend>
            <label
              >兴趣<input
                name="interests"
                :value="
                  Array.isArray(p.interests)
                    ? p.interests.join('，')
                    : p.interests
                "
                @input="p.interests = ($event.target as HTMLInputElement).value"
                placeholder="用逗号分隔" /></label
            ><label
              >禁用表达<textarea
                name="forbidden"
                :value="
                  Array.isArray(p.forbidden)
                    ? p.forbidden.join('\n')
                    : p.forbidden
                "
                @input="
                  p.forbidden = ($event.target as HTMLTextAreaElement).value
                "
                placeholder="每行一个不希望出现的表达"
              ></textarea>
            </label>
          </fieldset>
        </div>
        <div class="action-bar">
          <button class="primary" :disabled="busy">
            {{ busy ? "保存中…" : "保存人格 ↗" }}</button
          ><span class="small">保存后用于下一轮聊天</span>
        </div>
      </form>
      <form
        v-show="editorTab === 'prompts'"
        id="promptsForm"
        @submit="savePrompts"
        @input="markDirty"
      >
        <div class="form-scroll">
          <label
            >要编辑的指令<select v-model="promptKey">
              <option v-for="(_, key) in prompts" :key="key" :value="key">
                {{
                  (
                    {
                      system: "系统指令",
                      decision: "发言判断",
                      memory: "记忆整理",
                      vision: "图片理解",
                      generation: "回复生成",
                      validation: "回复检查",
                    } as any
                  )[key] || key
                }}
              </option>
            </select></label
          ><label
            >指令正文<textarea
              :name="promptKey"
              class="editor prompt-editor"
              v-model="prompts[promptKey]"
            ></textarea>
          </label>
        </div>
        <div class="action-bar">
          <button class="primary">保存 Prompt ↗</button>
        </div>
      </form>
    </section>
    <aside class="voice-preview surface" id="voice-lab">
      <div class="detail-heading">
        <div>
          <span class="eyebrow">VOICE CHECK</span>
          <h2>听听她怎么说</h2>
        </div>
        <button id="clearVoice" @click="clearVoice">清空</button>
      </div>
      <div id="voiceMeta" class="small preview-meta">{{ voiceMeta }}</div>
      <div id="voiceMessages" class="scroll-pane">
        <article
          v-for="(m, i) in history"
          :key="i"
          class="message"
          :class="{
            reply: m.role === 'assistant',
            bot: m.role === 'assistant',
          }"
        >
          <p>{{ m.text }}</p>
        </article>
        <div v-if="!history.length" class="empty-state">
          <span>“</span>
          <h3>一句话，感受她的性格</h3>
          <p>选择场景，或写下你想说的话。</p>
        </div>
      </div>
      <form id="voicePreviewForm" @submit="preview">
        <details class="scenario-picker">
          <summary>选择试聊场景</summary>
          <div class="scenario-grid">
            <button
              v-for="(scene, i) in studio.health.voice.scenarios"
              :key="scene.name"
              type="button"
              :data-voice-scene="i"
              @click="voiceText = scene.text"
            >
              {{ scene.name }}
            </button>
          </div>
        </details>
        <label
          >语气参考<select id="voiceStyleSession" v-model="styleSession">
            <option value="">默认普通口语</option>
            <option
              v-for="s in studio.core.sessions.filter(
                (x: any) => x.kind === 'group',
              )"
              :key="s.id"
              :value="s.id"
            >
              {{ s.name }}
            </option>
          </select></label
        ><label class="check"
          ><input
            id="voiceUseModel"
            type="checkbox"
            v-model="useModel"
          />使用真实模型（会消耗 Token）</label
        >
        <div class="composer">
          <input
            name="text"
            v-model="voiceText"
            placeholder="说一句试试看…"
            required
          /><button class="primary" :disabled="previewBusy">
            {{ previewBusy ? "思考中…" : "试聊 ↗" }}
          </button>
        </div>
      </form>
    </aside>
  </div>
</template>
