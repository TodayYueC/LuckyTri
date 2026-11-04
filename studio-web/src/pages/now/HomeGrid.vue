<script setup lang="ts">
import { computed } from "vue";
import { homeLayout } from "./home-layout";
const cards = computed(() =>
  homeLayout.order.filter((id) => !homeLayout.hidden.includes(id)),
);
</script>
<template>
  <div class="home-grid" :class="homeLayout.density">
    <div v-for="id in cards" :key="id" class="home-cell" :data-card="id">
      <slot :name="id" />
    </div>
  </div>
</template>
<style scoped>
@layer components {
  .home-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    align-items: stretch;
    grid-auto-rows: 280px;
  }
  .home-grid.compact {
    gap: 12px;
    grid-auto-rows: 260px;
  }
  .home-cell {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--r-l);
    display: flex;
    flex-direction: column;
  }
  .home-cell:last-child:nth-child(3n + 2) {
    grid-column: span 2;
  }
  .home-grid:has(.home-cell:only-child) {
    grid-template-columns: minmax(0, 1fr);
  }
  @media (max-width: 1200px) {
    .home-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .home-cell:last-child:nth-child(3n + 2) {
      grid-column: auto;
    }
    .home-cell:last-child:nth-child(2n + 1) {
      grid-column: 1/-1;
    }
  }
  @media (max-width: 680px) {
    .home-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    .home-cell:last-child {
      grid-column: auto !important;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .home-cell {
      transition: none !important;
    }
  }
}
</style>
