<script setup lang="ts">
import { t, locale } from "../../i18n";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api, toast } from "../../api";
import { requireLogin, waitForAccess } from "../../access";
import { ask } from "../../dialog";
import Empty from "../../components/ui/Empty.vue";

type Sticker = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  words: string;
  emotion: string;
  meaning: string;
  scenes: string;
  status: string;
  error?: string;
  animated: boolean;
  enabled: boolean;
  size: number;
};
const items = ref<Sticker[]>([]);
const categories = ref<{ category: string; n: number }[]>([]);
const q = ref("");
const category = ref("");
const uploadCategory = ref("");
const busy = ref("");
const editing = ref<Sticker | null>(null);
const draft = ref<any>({});
const fileInput = ref<HTMLInputElement>();
const pending = computed(
  () => items.value.filter((s) => s.status === "pending").length,
);

async function load() {
  const params = new URLSearchParams();
  if (q.value.trim()) params.set("q", q.value.trim());
  if (category.value) params.set("category", category.value);
  const data = await api(`/core/stickers?${params}`);
  items.value = data.items;
  categories.value = data.categories;
}
// While uploads are being analysed in the background, look again every few
// seconds so the progress and the finished descriptions show up by themselves.
let poll: ReturnType<typeof setTimeout> | undefined;
function watchProgress() {
  clearTimeout(poll);
  if (pending.value)
    poll = setTimeout(
      () =>
        load()
          .then(watchProgress)
          .catch(() => {}),
      3000,
    );
}
onMounted(() =>
  load()
    .then(watchProgress)
    .catch((e) => toast(e.message, true)),
);
onUnmounted(() => clearTimeout(poll));

async function upload(files: FileList | File[] | null) {
  const list = Array.from(files || []);
  if (!list.length) return;
  let done = 0;
  let failed = 0;
  await waitForAccess();
  for (const file of list) {
    busy.value = t("正在上传 {done}/{total}", { done, total: list.length });
    const params = new URLSearchParams({ name: file.name });
    if (uploadCategory.value.trim())
      params.set("category", uploadCategory.value.trim());
    const response = await fetch(`/api/core/stickers/upload?${params}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-LuckyTri-Locale": locale.value,
      },
      body: file,
    });
    if (response.status === 401) {
      requireLogin();
      break;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      failed++;
      toast(`${file.name}：${data.error || t("上传失败")}`, true);
    } else done++;
  }
  busy.value = "";
  toast(
    t("已上传 {done} 张，正在自动识别含义", { done }) +
      (failed ? t("，{failed} 张未通过", { failed }) : ""),
  );
  if (fileInput.value) fileInput.value.value = "";
  await load();
  watchProgress();
}

function drop(event: DragEvent) {
  event.preventDefault();
  upload(event.dataTransfer?.files || null);
}

function edit(item: Sticker) {
  editing.value = item;
  draft.value = { ...item, tags: item.tags.join("、") };
}
async function save() {
  if (!editing.value) return;
  try {
    await api(`/core/stickers/${editing.value.id}`, "PATCH", {
      name: draft.value.name,
      category: draft.value.category,
      tags: draft.value.tags,
      description: draft.value.description,
      words: draft.value.words,
      emotion: draft.value.emotion,
      meaning: draft.value.meaning,
      scenes: draft.value.scenes,
      enabled: draft.value.enabled,
    });
    editing.value = null;
    toast(t("已保存"));
    await load();
  } catch (e) {
    toast((e as Error).message, true);
  }
}
async function redo(item: Sticker) {
  await api(`/core/stickers/${item.id}/describe`, "POST", {});
  toast(t("已重新识别，稍后刷新查看"));
  await load();
  watchProgress();
}
async function remove(item: Sticker) {
  if (
    !(await ask(t("删除这张表情？它和大家一起用过的记录也会一并删除。"), {
      title: t("删除表情"),
      confirmText: t("删除"),
      cancelText: t("取消"),
    }))
  )
    return;
  await api(`/core/stickers/${item.id}`, "DELETE");
  editing.value = null;
  await load();
}
const statusLabel = (s: Sticker) =>
  s.status === "pending"
    ? t("识别中")
    : s.status === "failed"
      ? t("识别失败")
      : s.status === "manual"
        ? t("待手动填写")
        : "";
</script>

<template>
  <section class="card stickers">
    <div class="card-head">
      <div>
        <span class="eyebrow">{{ t("表情包") }}</span>
        <h2>{{ t("TA 收藏的表情") }}</h2>
        <p class="faint">
          {{
            t(
              "上传后会自动看懂画面、文字、情绪和用法，你可以随时修改。TA 只在觉得合适时才用，也会记得和谁用过、对方怎么回应。",
            )
          }}
        </p>
      </div>
    </div>
    <div
      class="drop"
      data-testid="sticker-drop"
      @dragover.prevent
      @drop="drop"
      @click="fileInput?.click()"
    >
      <b>{{ busy || t("拖入或点击选择图片，可一次选多张") }}</b>
      <small>{{ t("PNG、JPEG、GIF、WebP，每张不超过 2MB") }}</small>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        @change="upload(($event.target as HTMLInputElement).files)"
      />
    </div>
    <div class="toolbar">
      <input
        v-model="q"
        type="search"
        :placeholder="t('搜索描述、标签、情绪…')"
        @input="load()"
      />
      <select v-model="category" @change="load()">
        <option value="">{{ t("全部分类") }}</option>
        <option v-for="c in categories" :key="c.category" :value="c.category">
          {{ c.category }} · {{ c.n }}
        </option>
      </select>
      <input v-model="uploadCategory" :placeholder="t('上传到分类（可选）')" />
      <small v-if="pending" class="faint" data-testid="sticker-progress">{{
        t("{n} 张识别中", { n: pending })
      }}</small>
    </div>
    <Empty
      v-if="!items.length"
      :title="t('还没有表情')"
      :text="t('上传几张常用的表情，TA 就能在聊天里自己挑着用。')"
    />
    <div v-else class="grid">
      <button
        v-for="item in items"
        :key="item.id"
        class="tile"
        :class="{ off: !item.enabled }"
        type="button"
        @click="edit(item)"
      >
        <img
          :src="`/api/core/stickers/${item.id}/image`"
          :alt="item.description || item.name"
          loading="lazy"
        />
        <span class="caption">{{
          item.meaning || item.description || item.name
        }}</span>
        <span v-if="statusLabel(item)" class="badge">{{
          statusLabel(item)
        }}</span>
        <span v-if="item.animated" class="badge gif">GIF</span>
      </button>
    </div>
    <div v-if="editing" class="editor card" role="dialog">
      <div class="editor-head">
        <img :src="`/api/core/stickers/${editing.id}/image`" alt="" />
        <div>
          <b>{{ editing.name || t("未命名") }}</b>
          <small v-if="editing.error" class="danger">{{ editing.error }}</small>
        </div>
      </div>
      <div class="fields">
        <label
          >{{ t("名称") }}<input v-model="draft.name" maxlength="60"
        /></label>
        <label
          >{{ t("分类") }}<input v-model="draft.category" maxlength="24"
        /></label>
        <label class="wide"
          >{{ t("标签（用顿号或逗号分隔）") }}<input v-model="draft.tags"
        /></label>
        <label class="wide"
          >{{ t("画面") }}<textarea v-model="draft.description" rows="2" />
        </label>
        <label
          >{{ t("图上的字") }}<input v-model="draft.words" maxlength="100"
        /></label>
        <label
          >{{ t("情绪") }}<input v-model="draft.emotion" maxlength="40"
        /></label>
        <label class="wide"
          >{{ t("意思或梗") }}<textarea v-model="draft.meaning" rows="2" />
        </label>
        <label class="wide"
          >{{ t("适合的情境") }}<textarea v-model="draft.scenes" rows="2" />
        </label>
        <label class="check"
          ><input v-model="draft.enabled" type="checkbox" />{{
            t("TA 可以使用这张")
          }}</label
        >
      </div>
      <div class="save-bar">
        <button class="primary" type="button" @click="save">
          {{ t("保存") }}
        </button>
        <button type="button" @click="redo(editing)">
          {{ t("重新识别") }}
        </button>
        <button type="button" class="danger" @click="remove(editing)">
          {{ t("删除") }}
        </button>
        <button type="button" @click="editing = null">{{ t("关闭") }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stickers {
  display: grid;
  gap: 16px;
}
.drop {
  display: grid;
  place-items: center;
  gap: 4px;
  padding: 26px;
  border: 1.5px dashed var(--line);
  border-radius: 20px;
  cursor: pointer;
  text-align: center;
}
.drop:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}
@media (max-width: 760px) {
  .toolbar {
    grid-template-columns: 1fr;
  }
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 12px;
}
.tile {
  position: relative;
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgb(255 255 255 / 0.6);
  text-align: left;
}
.tile.off {
  opacity: 0.45;
}
.tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}
.caption {
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
}
.badge.gif {
  right: 8px;
  left: auto;
}
.editor {
  display: grid;
  gap: 14px;
}
.editor-head {
  display: flex;
  gap: 14px;
  align-items: center;
}
.editor-head img {
  width: 88px;
  height: 88px;
  object-fit: contain;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.fields label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.fields .wide {
  grid-column: 1 / -1;
}
.fields .check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.save-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.danger {
  color: #b3261e;
}
@media (max-width: 640px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
