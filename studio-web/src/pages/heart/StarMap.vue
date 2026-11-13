<script setup lang="ts">
import { t } from "../../i18n";
import { computed, ref } from "vue";
import { KIND_COLORS } from "../../plates/mind";

const props = defineProps<{
  threads: any[];
  kinds: Record<string, string>;
  activity?: string;
}>();
const emit = defineEmits<{ open: [thread: any] }>();
const visibleLimit = 6;
const expanded = ref<Record<string, boolean>>({});
const groups = computed(() =>
  [...new Set(props.threads.map((strand) => strand.kind))].map((kind) => ({
    kind,
    label: props.kinds[kind] || kind,
    color: KIND_COLORS[kind] || "var(--accent)",
    items: props.threads
      .filter((strand) => strand.kind === kind)
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0)),
  })),
);
const closeCount = computed(
  () =>
    props.threads.filter(
      (strand) => !strand.faded && (strand.salience ?? 0) >= 0.5,
    ).length,
);
function stateOf(strand: any) {
  return strand.faded
    ? t("暂时放远")
    : strand.core
      ? t("慢慢笃定")
      : t("还在生长");
}
function visibleItems(group: (typeof groups.value)[number]) {
  return expanded.value[group.kind]
    ? group.items
    : group.items.slice(0, visibleLimit);
}
function toggleGroup(kind: string) {
  expanded.value = { ...expanded.value, [kind]: !expanded.value[kind] };
}
</script>

<template>
  <section class="starmap" :aria-label="t('心灵星图：TA 关于自己的线索')">
    <header class="currents-head">
      <h2>{{ t("自我线索") }}</h2>
      <span
        >{{ threads.length }} {{ t("枚线索") }} · {{ closeCount }}
        {{ t("枚此刻贴近") }}</span
      >
    </header>
    <div class="current-grid">
      <section
        v-for="(group, index) in groups"
        :key="group.kind"
        class="current"
        :style="{ '--tone': group.color, '--order': index }"
      >
        <header class="current-head">
          <span class="current-icon" aria-hidden="true"><i></i></span>
          <div>
            <h4>{{ group.label }}</h4>
            <small>{{
              t("{length} 枚正在留存", { length: group.items.length })
            }}</small>
          </div>
          <span class="current-number">{{
            String(index + 1).padStart(2, "0")
          }}</span>
        </header>
        <div class="flecks">
          <button
            v-for="thread in visibleItems(group)"
            :key="thread.thread"
            type="button"
            class="fleck star"
            :class="{ faded: thread.faded, core: thread.core }"
            :data-thread="thread.thread"
            @click="emit('open', thread)"
          >
            <span class="fleck-light" aria-hidden="true"></span>
            <span class="fleck-copy"
              ><small>{{ stateOf(thread) }}</small
              ><b>{{ thread.content }}</b></span
            >
            <span class="fleck-arrow" aria-hidden="true">↗</span>
          </button>
          <button
            v-if="group.items.length > visibleLimit"
            type="button"
            class="fleck-more"
            :aria-expanded="Boolean(expanded[group.kind])"
            @click="toggleGroup(group.kind)"
          >
            {{
              expanded[group.kind]
                ? t("收起线索")
                : t("再看 {v} 枚光片", { v: group.items.length - visibleLimit })
            }}
            <span aria-hidden="true">{{
              expanded[group.kind] ? "↑" : "↓"
            }}</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .starmap {
    display: grid;
    gap: 18px;
    min-width: 0;
  }
  .currents-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .currents-head h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .currents-head > span {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .current-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
    align-items: stretch;
  }
  .current {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    padding: 22px;
    display: flex;
    flex-direction: column;
  }
  .current-head {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 18px;
  }
  .current-head h4 {
    font-size: 15px;
    font-weight: 600;
  }
  .current-head small {
    font-size: 11px;
    color: var(--ink-soft);
  }
  .current-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    background: color-mix(in srgb, var(--tone) 12%, var(--surface));
    border-radius: 11px;
  }
  .current-icon i {
    width: 9px;
    height: 9px;
    background: var(--tone);
    border-radius: 50%;
  }
  .current-number {
    margin-left: auto;
    color: var(--ink-faint);
    font-size: 11px;
  }
  .flecks {
    display: grid;
    gap: 8px;
  }
  .fleck {
    display: flex;
    gap: 10px;
    align-items: center;
    text-align: left;
    border: 1px solid var(--line);
    border-radius: 13px;
    padding: 12px;
    background: var(--surface);
    min-width: 0;
    transition:
      background 0.2s,
      transform 0.25s var(--spring);
  }
  .fleck:hover {
    background: color-mix(in srgb, var(--tone) 6%, var(--surface));
    transform: translateY(-2px);
  }
  .fleck-light {
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--tone);
    border-radius: 50%;
  }
  .fleck.faded .fleck-light {
    background: var(--ink-faint);
  }
  .fleck-copy {
    display: grid;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }
  .fleck-copy small {
    font-size: 10px;
    color: var(--ink-soft);
  }
  .fleck-copy b {
    font-size: 12px;
    line-height: 1.7;
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .fleck.core .fleck-copy b {
    font-weight: 600;
  }
  .fleck-arrow {
    color: var(--ink-faint);
    font-size: 12px;
  }
  .fleck-more {
    display: flex;
    justify-content: space-between;
    border: 0;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    padding: 10px 12px;
  }
  @media (max-width: 1200px) {
    .current-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 680px) {
    .current-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .currents-head {
      align-items: flex-start;
      flex-direction: column;
    }
  }
}
</style>
