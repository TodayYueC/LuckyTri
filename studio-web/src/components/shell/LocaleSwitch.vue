<script setup lang="ts">
import { LOCALES, locale, setLocale, t } from "../../i18n";
</script>

<template>
  <div
    id="locale"
    class="seg locale-switch"
    role="group"
    :aria-label="t('语言')"
  >
    <button
      v-for="item in LOCALES"
      :key="item.code"
      type="button"
      :lang="item.code === 'zh' ? 'zh-CN' : 'en'"
      :class="{ active: locale === item.code }"
      :aria-pressed="locale === item.code"
      :aria-label="item.label"
      :title="item.label"
      :data-locale="item.code"
      @click="setLocale(item.code)"
    >
      {{ item.short }}
    </button>
  </div>
</template>

<style scoped>
.locale-switch {
  flex-wrap: nowrap;
  gap: 2px;
  padding: 3px;
}
.locale-switch button {
  min-width: 36px;
  padding: 5px 10px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
@media (max-width: 760px) {
  .locale-switch button {
    min-width: 30px;
    padding: 5px 8px;
  }
}
</style>
