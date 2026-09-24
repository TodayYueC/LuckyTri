<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <template v-if="name === 'now'">
      <path
        d="M12 4.5c4.2 0 7 2.9 7 7.2 0 4.6-3 7.8-7 7.8s-7-3.2-7-7.8c0-4.3 2.8-7.2 7-7.2Z"
      />
      <path d="M9.4 11.4v.6M14.6 11.4v.6M10 15c1.2.9 2.8.9 4 0" />
    </template>
    <template v-else-if="name === 'chats'">
      <path
        d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 3.5v-3.5h-.5a2 2 0 0 1-2-2v-7Z"
      />
      <path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />
    </template>
    <template v-else-if="name === 'heart'">
      <path
        d="M12 3.5l1.6 4.4 4.6.2-3.6 2.9 1.3 4.5L12 12.9l-3.9 2.6 1.3-4.5-3.6-2.9 4.6-.2L12 3.5Z"
      />
      <path d="M5 19.5h.01M19 18.5h.01M18.5 4.5h.01" />
    </template>
    <template v-else-if="name === 'people'">
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="5.2" cy="7.2" r="1.7" />
      <circle cx="18.6" cy="8.4" r="1.4" />
      <circle cx="16.8" cy="18" r="1.9" />
      <path d="M6.6 8.4l3.3 2.1M17.3 9.1l-3 1.7M15.6 16.4l-1.7-2.3" />
    </template>
    <template v-else-if="name === 'life'">
      <path
        d="M12 6.5c-2-1.4-4.6-1.8-7.5-1.5v12.6c2.9-.3 5.5.1 7.5 1.5 2-1.4 4.6-1.8 7.5-1.5V5c-2.9-.3-5.5.1-7.5 1.5Z"
      />
      <path d="M12 6.5v12.6" />
    </template>
    <template v-else-if="name === 'memory'">
      <path
        d="M4.5 19.5h15M6 19.5V6.5h3v13M10.5 19.5V4.5h3v15M15.2 19.2l-.6-11.8 2.9-.4 1.2 11.8"
      />
    </template>
    <template v-else-if="name === 'nature'">
      <path d="M12 20v-7.5" />
      <path d="M12 12.5c0-4 2.6-6.8 6.8-7-.1 4.2-2.8 7-6.8 7Z" />
      <path d="M12 14.5c0-3-2-5.1-5.3-5.2.1 3.1 2.2 5.2 5.3 5.2Z" />
    </template>
    <template v-else-if="name === 'system'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"
      />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18" cy="12" r="1.3" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19 4.5V9h-4.5" />
    </template>
    <template v-else-if="name === 'send'">
      <path d="M4.5 11.8 19.5 5l-4.8 14.5-3.2-6.2-7-1.5Z" />
      <path d="m11.5 13.3 3.4-3.6" />
    </template>
    <template v-else-if="name === 'palette'">
      <path
        d="M12 4a8 8 0 1 0 0 16c1.2 0 1.8-.8 1.8-1.6 0-1.3-1.3-1.6-1.3-2.7 0-.9.7-1.5 1.7-1.5H16a4 4 0 0 0 4-4C20 6.9 16.4 4 12 4Z"
      />
      <path d="M8 11h.01M10 7.8h.01M14 7.8h.01M16.2 11h.01" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5.5v13M5.5 12h13" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="M14.5 6 8.5 12l6 6" />
    </template>
    <template v-else-if="name === 'motion'">
      <path d="M4 14c2.5-4 5.5-4 8 0s5.5 4 8 0" />
      <path d="M4 9c2.5-4 5.5-4 8 0s5.5 4 8 0" />
    </template>
    <template v-else-if="name === 'guide'">
      <circle cx="12" cy="12" r="8" />
      <path
        d="M9.8 9.6a2.3 2.3 0 1 1 3.3 2.1c-.7.3-1.1.9-1.1 1.6v.3M12 16.5h.01"
      />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="7" />
    </template>
  </svg>
</template>

<style scoped>
.icon {
  width: 20px;
  height: 20px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
