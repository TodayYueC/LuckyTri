<script setup lang="ts">
import Sheet from "../../components/ui/Sheet.vue";
import Field from "../../components/ui/Field.vue";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; add: [data: Record<string, string>] }>();

function submit(event: Event) {
  const form = event.target as HTMLFormElement;
  emit("add", Object.fromEntries(new FormData(form)) as Record<string, string>);
}
</script>

<template>
  <Sheet
    :open="open"
    title="添加群聊 / 私聊"
    eyebrow="NEW PLACE"
    width="440px"
    @close="emit('close')"
  >
    <form id="addSession" class="stack" @submit.prevent="submit">
      <p class="muted">
        添加之后再决定要不要让 TA 参与；开不开口仍由 TA 自己决定。
      </p>
      <Field label="类型">
        <select name="kind">
          <option value="group">群聊</option>
          <option value="private">私聊</option>
        </select>
      </Field>
      <Field label="群号 / QQ 号" hint="4–20 位数字">
        <input
          name="id"
          required
          pattern="\d{4,20}"
          inputmode="numeric"
          autocomplete="off"
        />
      </Field>
      <Field label="显示名称">
        <input name="name" required maxlength="100" autocomplete="off" />
      </Field>
      <button class="primary">添加会话</button>
    </form>
  </Sheet>
</template>
