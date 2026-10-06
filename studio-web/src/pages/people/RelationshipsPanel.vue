<script setup lang="ts">
import { ref, onMounted } from "vue";
import { t, N_, localized } from "../../i18n";
import { mind, DISCRETION, when } from "../../plates/mind";
import { toast } from "../../api";
import { ask } from "../../dialog";
import Sheet from "../../components/ui/Sheet.vue";
import Select from "../../components/ui/Select.vue";
const emit = defineEmits<{ changed: []; open: [id: string] }>();
const items = ref<any[]>([]),
  editing = ref(false),
  busy = ref(false);
const form = ref<any>({});
const roles = localized({
  妹妹: N_("妹妹"),
  姐姐: N_("姐姐"),
  弟弟: N_("弟弟"),
  哥哥: N_("哥哥"),
  朋友: N_("朋友"),
  伙伴: N_("伙伴"),
  custom: N_("其他关系"),
});
const selectedRole = ref("妹妹");
async function load() {
  items.value = (await mind.relationships()).items;
}
onMounted(() => load().catch((e) => toast(e.message, true)));
function edit(row?: any, subjectId = "") {
  form.value = row
    ? { ...row, expectedId: row.id }
    : {
        subjectId,
        channel: "onebot",
        accountId: "_",
        kind: "human",
        name: "",
        peerRole: "妹妹",
        selfRole: "",
        note: "",
        discretion: "open",
        expectedId: null,
      };
  selectedRole.value = Object.hasOwn(roles, form.value.peerRole)
    ? form.value.peerRole
    : "custom";
  editing.value = true;
}
defineExpose({ edit });
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    await mind.saveRelationship({
      ...form.value,
      peerRole:
        selectedRole.value === "custom"
          ? form.value.peerRole
          : selectedRole.value,
    });
    editing.value = false;
    await load();
    emit("changed");
    toast(t("关系已保存"));
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function end(row: any) {
  if (
    !(await ask(t("解除这份关系？相处留下的记忆和感受仍会保留。"), {
      title: t("解除关系"),
      confirmText: t("解除"),
      danger: true,
    }))
  )
    return;
  try {
    await mind.endRelationship(row.subjectId, {
      channel: row.channel,
      accountId: row.accountId,
      expectedId: row.id,
    });
    await load();
    emit("changed");
  } catch (e) {
    toast((e as Error).message, true);
  }
}
</script>
<template>
  <section class="card relationships">
    <header class="row">
      <div class="grow">
        <span class="eyebrow">RELATIONSHIPS</span>
        <h2>{{ t("彼此的关系") }}</h2>
      </div>
      <button @click="edit()">{{ t("绑定关系") }}</button>
    </header>
    <p class="muted">
      {{
        t(
          "按账号认出人或另一位机器人；关系融入关心、打算与交流，感情仍随着相处生长。",
        )
      }}
    </p>
    <div v-if="items.length" class="relationship-list">
      <article v-for="r in items" :key="r.id" class="relation">
        <div class="grow">
          <button class="text-button" @click="emit('open', r.subjectId)">
            {{ r.name || r.subjectId }}</button
          ><span class="chip">{{ roles[r.peerRole] || r.peerRole }}</span
          ><small class="muted"
            >{{ r.kind === "bot" ? t("另一位机器人") : t("人") }} ·
            {{ r.subjectId }}</small
          >
          <p v-if="r.note">{{ r.note }}</p>
          <small class="faint"
            >{{ when(r.created) }} · {{ DISCRETION[r.discretion] }}</small
          >
        </div>
        <div class="row">
          <button class="small" @click="edit(r)">{{ t("修改") }}</button
          ><button class="text-button" @click="end(r)">{{ t("解除") }}</button>
        </div>
      </article>
    </div>
    <p v-else class="faint">
      {{ t("还没有绑定关系，可以从一个准确的账号开始。") }}
    </p>
  </section>
  <Sheet
    :open="editing"
    :title="t('绑定关系')"
    :eyebrow="t('彼此的关系')"
    width="560px"
    @close="editing = false"
  >
    <form class="stack" @submit.prevent="save">
      <div class="fields">
        <label
          >{{ t("平台")
          }}<Select
            v-model="form.channel"
            :disabled="!!form.id"
            :options="[
              { value: 'onebot', label: 'QQ / OneBot' },
              { value: 'qqbot', label: t('QQ 官方机器人') },
            ]"
        /></label>
        <label
          >{{ t("对方账号")
          }}<input
            v-model="form.subjectId"
            required
            :readonly="!!form.id"
            maxlength="128"
            :placeholder="t('QQ 号或平台用户 ID')"
        /></label>
        <label
          >{{ t("对象类型")
          }}<Select
            v-model="form.kind"
            :options="[
              { value: 'human', label: t('人') },
              { value: 'bot', label: t('另一位机器人') },
            ]"
        /></label>
        <label
          >{{ t("对方名字")
          }}<input
            v-model="form.name"
            maxlength="40"
            :placeholder="t('可选，未填写时使用已认识的名字')"
        /></label>
        <label
          >{{ t("对方是我的")
          }}<Select
            v-model="selectedRole"
            :options="
              Object.entries(roles).map(([value, label]) => ({ value, label }))
            "
        /></label>
        <label
          >{{ t("我是对方的")
          }}<input
            v-model="form.selfRole"
            maxlength="24"
            :placeholder="t('留空时按当前身份生成对应称呼')"
        /></label>
      </div>
      <label v-if="selectedRole === 'custom'"
        >{{ t("关系称呼")
        }}<input v-model="form.peerRole" required maxlength="24"
      /></label>
      <label v-if="form.channel === 'qqbot'"
        >{{ t("应用账号")
        }}<input
          v-model="form.accountId"
          :readonly="!!form.id"
          required
          maxlength="128"
      /></label>
      <label
        >{{ t("关系公开范围")
        }}<Select
          v-model="form.discretion"
          :options="
            Object.entries(DISCRETION).map(([value, label]) => ({
              value,
              label,
            }))
          "
      /></label>
      <label
        >{{ t("这份关系的缘由")
        }}<textarea
          v-model="form.note"
          rows="3"
          maxlength="300"
          :placeholder="t('可选，写下真实的安排或缘由')"
        />
      </label>
      <p class="faint">
        {{
          t(
            "绑定称呼不会凭空增加相处经历、信任或对方的同意。私下关系只在与对方的私聊中使用。",
          )
        }}
      </p>
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? t("正在保存…") : t("保存关系") }}
      </button>
    </form>
  </Sheet>
</template>
<style scoped>
.relationships {
  display: grid;
  gap: 14px;
}
h2 {
  margin-top: 5px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.relationship-list {
  display: grid;
  gap: 10px;
}
.relation {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--surface);
}
.relation small {
  display: block;
  margin-top: 5px;
}
.relation p {
  margin-top: 8px;
  overflow-wrap: anywhere;
}
.chip {
  margin-left: 8px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
label {
  display: grid;
  gap: 7px;
}
@media (max-width: 510px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
