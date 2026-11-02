<script setup lang="ts">
import { computed } from "vue";
import { homeLayout } from "./home-layout";
const cards = computed(() =>
  homeLayout.order.filter((id) => !homeLayout.hidden.includes(id)),
);
</script>
<template>
  <TransitionGroup
    name="home-card"
    tag="div"
    class="home-grid"
    :class="homeLayout.density"
  >
    <div v-for="id in cards" :key="id" class="home-cell" :data-card="id">
      <slot :name="id" />
    </div>
  </TransitionGroup>
</template>
<style scoped>
@layer components {
  .home-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
    align-items: stretch;
  }
  .home-grid.compact {
    gap: 12px;
  }
  .home-cell {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .home-cell:last-child:nth-child(3n + 2) {
    grid-column: span 2;
  }
  .home-card-move,
  .home-card-enter-active,
  .home-card-leave-active {
    transition:
      transform 0.35s var(--ease),
      opacity 0.2s;
  }
  .home-card-enter-from,
  .home-card-leave-to {
    opacity: 0;
    transform: translateY(10px);
  }
  .home-card-leave-active {
    position: absolute;
    pointer-events: none;
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
