<script setup lang="ts">
import { computed } from "vue";
import { wallpapers } from "../../wallpaper";
import { mood, motionOn } from "../../mood/useMood";
import sky from "../../assets/sky-daylight.webp";
const picture = computed(() => ({
  backgroundImage: `url("${wallpapers.sky || sky}")`,
  opacity: wallpapers.sky ? wallpapers.skyOpacity : 0.16,
}));
</script>
<template>
  <div
    class="sky"
    :data-mood="mood"
    :data-particles="motionOn ? 'still' : 'off'"
    aria-hidden="true"
  >
    <div class="sky-picture" :style="picture"></div>
    <div class="sky-tint"></div>
  </div>
</template>
<style scoped>
@layer components {
  .sky {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    overflow: hidden;
    background: color-mix(in srgb, var(--sky-mid) 18%, #f6f7fb);
    contain: strict;
  }
  .sky-picture {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
  }
  .sky-tint {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      120deg,
      color-mix(in srgb, var(--sky-top) 22%, transparent),
      color-mix(in srgb, var(--sky-bottom) 12%, transparent)
    );
  }
  .sky[data-mood="night"] .sky-tint {
    background: linear-gradient(
      140deg,
      rgba(50, 59, 123, 0.22),
      rgba(116, 85, 154, 0.14)
    );
  }
}
</style>
