<script setup lang="ts">
import { ref } from "vue";
import { toast } from "../../api";
import {
  resetHeroWallpaper,
  resetSkyWallpaper,
  setHeroWallpaper,
  setSkyOpacity,
  setSkyWallpaper,
  wallpapers,
} from "../../wallpaper";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const heroInput = ref<HTMLInputElement>();
const skyInput = ref<HTMLInputElement>();
const busy = ref("");

async function pick(kind: "hero" | "sky", event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = kind;
  try {
    if (kind === "hero") await setHeroWallpaper(file);
    else await setSkyWallpaper(file);
    toast(kind === "hero" ? "中间这张已换上" : "后面的壁纸已换上");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = "";
  }
}

async function reset(kind: "hero" | "sky") {
  busy.value = kind;
  try {
    if (kind === "hero") await resetHeroWallpaper();
    else await resetSkyWallpaper();
    toast("已恢复原来的壁纸");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <section v-if="open" class="wallpaper-picker" aria-label="换壁纸">
    <header>
      <b>换壁纸</b>
      <button type="button" class="text-button" @click="emit('close')">收起</button>
    </header>
    <div class="choice">
      <span>中间这张</span>
      <div class="row">
        <button type="button" :disabled="!!busy" @click="heroInput?.click()">
          {{ busy === "hero" ? "处理中…" : "选择图片" }}
        </button>
        <button type="button" :disabled="!!busy" @click="reset('hero')">恢复默认</button>
      </div>
    </div>
    <div class="choice">
      <span>后面的大壁纸</span>
      <div class="row">
        <button type="button" :disabled="!!busy" @click="skyInput?.click()">
          {{ busy === "sky" ? "处理中…" : "选择图片" }}
        </button>
        <button type="button" :disabled="!!busy" @click="reset('sky')">恢复默认</button>
      </div>
      <label v-if="wallpapers.sky" class="opacity">
        <span>透明度 {{ Math.round(wallpapers.skyOpacity * 100) }}%</span>
        <input
          type="range"
          min="0.08"
          max="0.82"
          step="0.02"
          :value="wallpapers.skyOpacity"
          aria-label="后面壁纸的透明度"
          @input="setSkyOpacity(Number(($event.target as HTMLInputElement).value))"
        />
        <small>越透明，心情的颜色越清楚。</small>
      </label>
    </div>
    <input
      ref="heroInput"
      data-wallpaper="hero"
      type="file"
      accept="image/*"
      hidden
      @change="pick('hero', $event)"
    />
    <input
      ref="skyInput"
      data-wallpaper="sky"
      type="file"
      accept="image/*"
      hidden
      @change="pick('sky', $event)"
    />
  </section>
</template>

<style scoped>
.wallpaper-picker {
  position: absolute;
  top: 62px;
  right: 16px;
  z-index: 6;
  display: grid;
  gap: 12px;
  width: min(280px, calc(100% - 32px));
  max-height: calc(100% - 78px);
  overflow: auto;
  padding: 14px;
  border: 1px solid rgb(255 255 255 / 0.86);
  border-radius: 22px;
  background: rgb(255 255 255 / 0.82);
  box-shadow:
    inset 0 1px 0 white,
    0 18px 40px -24px rgb(39 69 128 / 0.55);
  backdrop-filter: blur(18px) saturate(1.4);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
header b {
  font-size: 14px;
}
.choice {
  display: grid;
  gap: 8px;
}
.choice > span {
  font-size: 12.5px;
  font-weight: 700;
}
.row {
  display: flex;
  gap: 8px;
}
.row button {
  flex: 1;
  min-height: 32px;
  padding: 6px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.opacity {
  display: grid;
  gap: 4px;
}
.opacity span,
.opacity small {
  color: var(--ink-soft);
  font-size: 12px;
}
.opacity input {
  width: 100%;
  accent-color: var(--accent);
}
</style>
