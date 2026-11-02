<script setup lang="ts">
import { t } from "../../i18n";
import { computed } from "vue";
import { hueOf, initials } from "../../format";

const props = defineProps<{ people: any[]; activity?: string }>();
const emit = defineEmits<{ open: [id: string]; list: [] }>();
const ranked = computed(() =>
  [...props.people].sort((a, b) => (b.familiarity ?? 0) - (a.familiarity ?? 0)),
);
const featured = computed(() => ranked.value.slice(0, 12));
const hidden = computed(() =>
  Math.max(0, ranked.value.length - featured.value.length),
);
</script>

<template>
  <section class="galaxy" :aria-label="t('相遇之间：TA 认识的人')">
    <header class="people-heading">
      <h2>{{ t("最近靠近的人") }}</h2>
      <span>{{ people.length }} {{ t("个相遇过的人") }}</span>
    </header>
    <div class="encounter-grid">
      <button
        v-for="(person, index) in featured"
        :key="person.userId"
        type="button"
        class="person-node"
        :class="{
          away: (person.awayDays ?? 0) >= 14,
          tense: person.tension >= 0.3,
        }"
        :data-person="person.userId"
        :style="{
          '--hue': hueOf(person.name || person.userId),
          '--order': index,
        }"
        :aria-label="`${person.name}：${person.feel || t('还在慢慢认识')}`"
        @click="emit('open', person.userId)"
      >
        <span class="avatar-wrap"
          ><span class="avatar">{{ initials(person.name) }}</span></span
        >
        <span class="person-copy"
          ><b>{{ person.name }}</b
          ><small>QQ {{ person.userId }}</small
          ><small>{{ person.feel || t("还在慢慢认识") }}</small></span
        >
        <span class="person-arrow" aria-hidden="true">↗</span>
        <span
          class="familiarity"
          :style="{
            '--amount':
              Math.round(
                Math.max(0, Math.min(1, person.familiarity ?? 0)) * 100,
              ) + '%',
          }"
          aria-hidden="true"
          ><i></i
        ></span>
      </button>
    </div>
    <button
      v-if="hidden"
      type="button"
      class="more-people"
      @click="emit('list')"
    >
      {{ t("在名单里看看另外 {hidden} 个人", { hidden }) }}
      <span aria-hidden="true">↗</span>
    </button>
  </section>
</template>

<style scoped>
@layer components {
  .galaxy {
    display: grid;
    gap: 18px;
    min-width: 0;
  }
  .people-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .people-heading h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .people-heading > span {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .encounter-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
  .person-node {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-width: 0;
    text-align: left;
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 22px 22px 30px;
    background: var(--surface);
    overflow: hidden;
    transition:
      transform 0.25s var(--spring),
      background 0.2s;
  }
  .person-node:hover {
    transform: translateY(-3px);
    background: color-mix(in srgb, var(--accent-soft) 15%, var(--surface));
  }
  .avatar-wrap {
    flex: none;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 15px;
    font-size: 16px;
    background: hsl(var(--hue) 45% 94%);
    color: hsl(var(--hue) 35% 42%);
  }
  .person-copy {
    display: grid;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .person-copy b {
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .person-copy small {
    font-size: 12px;
    line-height: 1.7;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  .person-copy small:first-of-type {
    font-size: 10px;
    color: var(--ink-faint);
  }
  .person-arrow {
    font-size: 12px;
    color: var(--ink-faint);
  }
  .familiarity {
    position: absolute;
    bottom: 16px;
    left: 22px;
    right: 22px;
    height: 3px;
    background: var(--line);
    border-radius: 2px;
  }
  .familiarity i {
    display: block;
    width: var(--amount);
    height: 100%;
    background: var(--accent);
    opacity: 0.5;
    border-radius: 2px;
  }
  .tense .familiarity i {
    background: var(--warn);
  }
  .away .avatar {
    filter: saturate(0.35);
  }
  .more-people {
    justify-self: start;
    font-size: 12px;
    padding: 11px 16px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  @media (max-width: 1200px) {
    .encounter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 680px) {
    .encounter-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
