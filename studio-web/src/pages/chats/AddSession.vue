<script setup lang="ts">
import { computed, ref } from "vue";
import Sheet from "../../components/ui/Sheet.vue";
import Field from "../../components/ui/Field.vue";
import Select from "../../components/ui/Select.vue";
import { t } from "../../i18n";

const props = defineProps<{
  open: boolean;
  channel: "onebot" | "qqbot";
  ready: boolean;
}>();
const kind = ref("group");
const emit = defineEmits<{ close: []; add: [data: Record<string, string>] }>();

const official = computed(() => props.channel === "qqbot");
// Each platform names its rooms differently; the form asks for what the
// connected one uses.
const pattern = computed(() =>
  official.value ? "[0-9A-Za-z_\\-]{8,64}" : "\\d{4,20}",
);

function submit(event: Event) {
  const form = event.target as HTMLFormElement;
  emit("add", {
    ...(Object.fromEntries(new FormData(form)) as Record<string, string>),
    channel: props.channel,
  });
}
</script>

<template>
  <Sheet
    :open="open"
    :title="t('添加群聊 / 私聊')"
    :eyebrow="t('NEW PLACE')"
    width="440px"
    @close="emit('close')"
  >
    <form id="addSession" class="stack" @submit.prevent="submit">
      <p class="muted">
        {{ t("添加之后再决定要不要让 TA 参与；开不开口仍由 TA 自己决定。") }}
      </p>
      <p v-if="official && !ready" class="notice" role="status">
        {{ t("请先在「连接 QQ」里填写机器人的 AppID") }}
      </p>
      <Field :label="t('类型')">
        <Select
          v-model="kind"
          name="kind"
          :aria-label="t('类型')"
          :options="[
            { value: 'group', label: t('群聊') },
            { value: 'private', label: t('私聊') },
          ]"
        />
      </Field>
      <Field
        :label="official ? t('群 openid / 用户 openid') : t('群号 / QQ 号')"
        :hint="
          official
            ? t(
                '8–64 位字母、数字、下划线或短横线。官方平台的会话通常会在有人 @ 她或私聊她时自动出现，这里只用于提前登记。',
              )
            : t('4–20 位数字')
        "
      >
        <input
          name="id"
          required
          :pattern="pattern"
          :inputmode="official ? 'text' : 'numeric'"
          autocomplete="off"
        />
      </Field>
      <Field :label="t('显示名称')">
        <input name="name" required maxlength="100" autocomplete="off" />
      </Field>
      <button class="primary" :disabled="official && !ready">
        {{ t("添加会话") }}
      </button>
    </form>
  </Sheet>
</template>
