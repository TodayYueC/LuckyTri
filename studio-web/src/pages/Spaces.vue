<script setup lang="ts">
import { ref } from "vue";
import { studio, reload } from "../store";
import { toast } from "../api";
import {
  addSession as createSession,
  archiveSession,
  deleteSession,
  saveSession as putSession,
  setSessionEnabled,
} from "../plates/sessions";

const query = ref("");
function active() {
  return (studio.core.sessions || []).filter(
    (s: any) =>
      !s.archived &&
      `${s.name} ${s.id}`.toLowerCase().includes(query.value.toLowerCase()),
  );
}
function archived() {
  return (studio.core.sessions || []).filter((s: any) => s.archived);
}
function personaText(value: any) {
  if (!value || typeof value !== "object") return "";
  const keys = Object.keys(value);
  return keys.length <= 1 && keys[0] === "base"
    ? String(value.base || "")
    : JSON.stringify(value, null, 2);
}

async function addSession(e: Event) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target as HTMLFormElement));
  await createSession(data);
  await reload();
  toast("会话已添加");
}

async function toggle(s: any) {
  await setSessionEnabled(s.id, !s.enabled);
  await reload();
}

async function archive(id: string, archivedFlag: boolean) {
  await archiveSession(id, archivedFlag);
  await reload();
}

async function remove(id: string) {
  if (!confirm("永久删除这个会话？")) return;
  await deleteSession(id);
  await reload();
}

async function saveSession(e: Event, s: any) {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const v: any = Object.fromEntries(new FormData(f));
  for (const k of ["aggregateMs", "maxWaitMs", "contextMessages", "maxReply"])
    v[k] = Number(v[k]);
  v.probability = Number(v.probability);
  v.cooldown = Number(v.cooldown);
  v.memory = (f.elements.namedItem("memory") as HTMLInputElement).checked;
  v.comfortOnDistress = (
    f.elements.namedItem("comfortOnDistress") as HTMLInputElement
  ).checked;
  v.deepCheck = (f.elements.namedItem("deepCheck") as HTMLInputElement).checked;
  const personaRaw = String(v.persona || "").trim();
  delete v.persona;
  if (personaRaw) {
    try {
      const parsed = JSON.parse(personaRaw);
      v.persona =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : { base: personaRaw };
    } catch {
      v.persona = { base: personaRaw };
    }
  }
  const probability = Number(v.probability);
  const cooldown = Number(v.cooldown);
  await putSession(s.id, { ...v, name: s.name, probability, cooldown });
  studio.dirty = false;
  toast("会话配置已保存");
  await reload();
}
</script>

<template>
  <section class="panel">
    <h2>添加群聊 / 私聊</h2>
    <form id="addSession" @submit="addSession">
      <div class="grid">
        <label
          >类型
          <select name="kind">
            <option value="group">群聊</option>
            <option value="private">私聊</option>
          </select>
        </label>
        <label
          >群号 / QQ号<input name="id" required pattern="\d{4,20}"
        /></label>
        <label>显示名称<input name="name" required maxlength="100" /></label>
      </div>
      <button class="primary">添加并显示</button>
    </form>
  </section>
  <div class="session-filter">
    <label
      >查找会话<input
        v-model="query"
        placeholder="输入群名、群号或用户名" /></label
    ><span class="small">{{ active().length }} 个会话</span>
  </div>
  <p v-if="!active().length" class="notice">
    暂无匹配会话。你可以在上方添加，或换一个关键词。
  </p>
  <section v-for="s in active()" :key="s.id" class="panel">
    <h2>{{ s.name }}</h2>
    <div class="row">
      <span class="pill">{{ s.enabled ? "参与中" : "已暂停" }}</span>
      <code>{{ s.id }}</code>
      <button
        :id="s.id === active()[0]?.id ? 'toggleSession' : undefined"
        :data-toggle="s.id"
        @click="toggle(s)"
      >
        {{ s.enabled ? "暂停参与" : "开启参与" }}
      </button>
      <button :data-archive="s.id" @click="archive(s.id, true)">
        移出面板
      </button>
    </div>
    <form
      :data-session="s.id"
      @submit="(e) => saveSession(e, s)"
      @input="studio.dirty = true"
    >
      <div class="grid">
        <label
          >模型
          <select name="modelId" :value="s.policy.modelId || 'default'">
            <option v-for="m in studio.core.models" :key="m.id" :value="m.id">
              {{ m.label || m.model }}
            </option>
          </select>
        </label>
        <label
          >视觉兼容模型
          <select name="visionModelId" :value="s.policy.visionModelId || ''">
            <option value="">跟随主模型</option>
            <option
              v-for="m in studio.core.models.filter((x: any) => x.vision)"
              :key="m.id"
              :value="m.id"
            >
              {{ m.label || m.model }}
            </option>
          </select>
        </label>
        <label
          >旁听后的参与概率 0–1<input
            name="probability"
            type="number"
            step="0.01"
            :value="s.probability ?? studio.health.settings.probability"
        /></label>
        <label
          >冷却秒数<input
            name="cooldown"
            type="number"
            :value="s.cooldown ?? studio.health.settings.cooldown"
        /></label>
      </div>
      <details>
        <summary>高级策略</summary>
        <div class="grid">
          <label
            >聚合窗口 ms<input
              name="aggregateMs"
              type="number"
              :value="s.policy.aggregateMs"
          /></label>
          <label
            >最长等待 ms<input
              name="maxWaitMs"
              type="number"
              :value="s.policy.maxWaitMs"
          /></label>
          <label
            >近期条数（0 = 使用模型预算）<input
              name="contextMessages"
              type="number"
              :value="s.policy.contextMessages"
          /></label>
          <label
            >一轮总字数<input
              name="maxReply"
              type="number"
              :value="s.policy.maxReply"
          /></label>
        </div>
        <label class="check"
          ><input
            name="memory"
            type="checkbox"
            :checked="s.policy.memory"
          />长期记忆</label
        >
        <label class="check"
          ><input
            name="comfortOnDistress"
            type="checkbox"
            :checked="s.policy.comfortOnDistress"
          />明显低落时主动简短安慰</label
        >
        <label class="check"
          ><input
            name="deepCheck"
            type="checkbox"
            :checked="s.policy.deepCheck"
          />复杂回复模型复审</label
        >
        <label
          >仅在此会话使用的人设（留空沿用全局）<textarea name="persona">{{
            personaText(s.policy.persona)
          }}</textarea>
        </label>
      </details>
      <button class="primary" type="submit">保存并应用</button>
      <span class="small">保存后下一轮生效</span>
    </form>
  </section>
  <section v-if="archived().length" class="panel">
    <h2>已移出面板（可恢复）</h2>
    <div v-for="s in archived()" :key="s.id" class="row archived-session">
      <span>{{ s.name }}</span>
      <code>{{ s.id }}</code>
      <button :data-restore-session="s.id" @click="archive(s.id, false)">
        恢复显示
      </button>
      <button :data-delete-session="s.id" @click="remove(s.id)">
        永久删除
      </button>
    </div>
  </section>
</template>
