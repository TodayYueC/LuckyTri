<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../i18n";
import Popover from "../../components/ui/Popover.vue";
import Icon from "../../components/ui/Icon.vue";
import {
  HOME_CARDS,
  homeLayout,
  moveHome,
  toggleHome,
  resetHome,
} from "./home-layout";
const open = ref(false);
</script>
<template>
  <Popover v-model="open" :title="t('自定义首页')" :width="370">
    <template #trigger
      ><Icon name="layout" /><span>{{ t("自定义首页") }}</span></template
    >
    <div class="home-density">
      <span>{{ t("卡片间距") }}</span>
      <div class="row">
        <button
          :aria-pressed="homeLayout.density === 'comfortable'"
          @click="homeLayout.density = 'comfortable'"
        >
          {{ t("舒适") }}</button
        ><button
          :aria-pressed="homeLayout.density === 'compact'"
          @click="homeLayout.density = 'compact'"
        >
          {{ t("紧凑") }}
        </button>
      </div>
    </div>
    <p class="muted home-layout-hint">
      {{ t("选择显示的卡片，并调整阅读顺序。") }}
    </p>
    <ol class="home-layout-list">
      <li v-for="(id, index) in homeLayout.order" :key="id">
        <label
          ><input
            type="checkbox"
            :checked="!homeLayout.hidden.includes(id)"
            :disabled="
              !homeLayout.hidden.includes(id) &&
              homeLayout.hidden.length === homeLayout.order.length - 1
            "
            @change="toggleHome(id)"
          />{{ HOME_CARDS.find((c) => c.id === id)?.label }}</label
        >
        <button
          :disabled="index === 0"
          :aria-label="
            t('上移 {name}', {
              name: HOME_CARDS.find((c) => c.id === id)?.label,
            })
          "
          @click="moveHome(id, -1)"
        >
          ↑
        </button>
        <button
          :disabled="index === homeLayout.order.length - 1"
          :aria-label="
            t('下移 {name}', {
              name: HOME_CARDS.find((c) => c.id === id)?.label,
            })
          "
          @click="moveHome(id, 1)"
        >
          ↓
        </button>
      </li>
    </ol>
    <button class="text-button" @click="resetHome">
      {{ t("恢复默认布局") }}
    </button>
  </Popover>
</template>
<style scoped>
@layer components {
  .home-density {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  .home-density button {
    padding: 7px 11px;
    font-size: 12px;
  }
  .home-density button[aria-pressed="true"] {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .home-layout-hint {
    font-size: 12px;
    margin: 18px 0 10px;
  }
  .home-layout-list {
    list-style: none;
    padding: 0;
    margin: 0 0 15px;
    display: grid;
    gap: 4px;
  }
  .home-layout-list li {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  .home-layout-list label {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    cursor: pointer;
  }
  .home-layout-list input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .home-layout-list button {
    padding: 5px;
    width: 30px;
    height: 30px;
    background: none;
    border: 0;
  }
  .home-layout-list button:hover {
    background: var(--accent-soft);
  }
}
</style>
