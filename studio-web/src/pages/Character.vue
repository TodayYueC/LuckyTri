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

const p = reactive({ ...studio.core.persona });
const settings = reactive({ ...studio.health.settings });
const history = ref<{ role: string; text: string }[]>([]);
const voiceText = ref("Lucky，今天真的好难过");
const voiceMeta = ref(
  "规则样例不读取自定义人格；真实模型试聊使用当前人格草稿，保存后才应用到 QQ。",
);
const useModel = ref(false);
const styleSession = ref("");
const showPrompts = ref(false);
const prompts = reactive({ ...studio.core.prompts });

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
  await putPersona({
    ...p,
    interests: list(p.interests),
    forbidden: list(p.forbidden),
  });
  await patchSettings({
    persona: settings.persona,
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
  toast("已保存并应用");
}

async function savePrompts(e: Event) {
  e.preventDefault();
  await putPrompts({ ...prompts });
  studio.dirty = false;
  toast("Prompt 已保存，下一轮生效");
}

async function preview(e: Event) {
  e.preventDefault();
  try {
    const r = await previewVoice({
      text: voiceText.value,
      useModel: useModel.value,
      styleSession: styleSession.value,
      persona: settings.persona,
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
  }
}

function clearVoice() {
  history.value = [];
}
</script>

<template>
  <section class="panel" id="persona">
    <form id="personaForm" @submit="savePersona" @input="markDirty">
      <p class="small">自然表达优先。程度 0–100；Prompt 放在下方高级折叠。</p>
      <div class="grid">
        <label>名字<input v-model="p.name" name="name" /></label>
        <label>说话长度<input v-model="p.length" name="length" /></label>
        <label>当前情绪<input v-model="p.mood" name="mood" /></label>
        <label
          >幽默程度 0–100<input
            name="humor"
            type="number"
            v-model.number="p.humor"
        /></label>
        <label
          >毒舌程度 0–100<input
            name="sarcasm"
            type="number"
            v-model.number="p.sarcasm"
        /></label>
        <label
          >温柔程度 0–100<input
            name="warmth"
            type="number"
            v-model.number="p.warmth"
        /></label>
        <label
          >活泼程度 0–100<input
            name="activity"
            type="number"
            v-model.number="p.activity"
        /></label>
        <label
          >主动程度 0–100<input
            name="initiative"
            type="number"
            v-model.number="p.initiative"
        /></label>
        <label
          >发言冷却（秒）<input
            name="cooldown"
            type="number"
            v-model.number="settings.cooldown"
        /></label>
        <label
          >旁听后的参与概率<input
            name="probability"
            type="number"
            step="0.01"
            v-model.number="settings.probability"
        /></label>
        <label
          >网络梗
          <input
            name="slangLevel"
            type="range"
            min="0"
            max="2"
            v-model.number="settings.slangLevel"
          />
        </label>
      </div>
      <label
        >基础人格 / 人设草稿<textarea
          name="persona"
          v-model="settings.persona"
        ></textarea>
      </label>
      <label
        >核心人格正文<textarea
          name="base"
          v-model="p.base"
          class="editor"
        ></textarea>
      </label>
      <div class="row">
        <label
          v-for="preset in studio.health.voice.presets"
          :key="preset.id"
          class="voice-preset"
          :class="{ picked: settings.voicePreset === preset.id }"
        >
          <input
            type="radio"
            name="voicePreset"
            :value="preset.id"
            v-model="settings.voicePreset"
          />
          {{ preset.name }}
        </label>
      </div>
      <label class="check"
        ><input
          name="allowMildProfanity"
          type="checkbox"
          v-model="settings.allowMildProfanity"
        />允许轻度脏话</label
      >
      <label class="check"
        ><input
          name="adaptGroupStyle"
          type="checkbox"
          v-model="settings.adaptGroupStyle"
        />参考群体习惯</label
      >
      <label class="check"
        ><input
          name="qualityRewrite"
          type="checkbox"
          v-model="settings.qualityRewrite"
        />质量重写</label
      >
      <button class="primary" type="submit">保存并应用</button>
      <span class="small">保存后下一轮生效</span>
    </form>
  </section>
  <section class="panel" id="voice-lab">
    <h2>口吻试聊</h2>
    <div id="voiceMeta" class="small">{{ voiceMeta }}</div>
    <div id="voiceMessages">
      <article
        v-for="(m, i) in history"
        :key="i"
        class="message"
        :class="{ reply: m.role === 'assistant', bot: m.role === 'assistant' }"
      >
        <p>{{ m.text }}</p>
      </article>
    </div>
    <form id="voicePreviewForm" @submit="preview">
      <label
        >语气参考
        <select id="voiceStyleSession" v-model="styleSession">
          <option value="">默认普通口语</option>
          <option
            v-for="s in studio.core.sessions.filter(
              (x: any) => String(x.kind) === 'group',
            )"
            :key="s.id"
            :value="s.id"
          >
            {{ s.name }}
          </option>
        </select>
      </label>
      <label class="check"
        ><input
          id="voiceUseModel"
          type="checkbox"
          v-model="useModel"
        />使用真实模型</label
      >
      <label>句子<input name="text" v-model="voiceText" /></label>
      <div class="row">
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
      <button class="primary">试聊一句</button>
      <button type="button" id="clearVoice" @click="clearVoice">
        清空试聊
      </button>
    </form>
  </section>
  <section class="panel">
    <details
      :open="showPrompts"
      @toggle="showPrompts = ($event.target as HTMLDetailsElement).open"
    >
      <summary>Prompt 高级编辑</summary>
      <form id="promptsForm" @submit="savePrompts" @input="markDirty">
        <label v-for="(value, key) in prompts" :key="key"
          >{{ key }}
          <textarea
            :name="key"
            class="editor"
            v-model="prompts[key]"
          ></textarea>
        </label>
        <button class="primary">保存 Prompt</button>
      </form>
    </details>
  </section>
</template>
