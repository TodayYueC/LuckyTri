<script setup lang="ts">
import { ref } from "vue";
import { authRequest, signOut } from "../access";
import { toast } from "../api";
import { t } from "../i18n";
const currentPassword = ref("");
const password = ref("");
const confirmation = ref("");
const busy = ref(false);
async function save() {
  if (busy.value) return;
  if (password.value !== confirmation.value) {
    toast(t("两次输入的密码不一致"), true);
    return;
  }
  busy.value = true;
  try {
    await authRequest("password", {
      currentPassword: currentPassword.value,
      password: password.value,
    });
    currentPassword.value = password.value = confirmation.value = "";
    toast(t("管理密码已更新"));
  } catch (cause) {
    toast((cause as Error).message, true);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="card password-settings">
    <h2>{{ t("管理密码") }}</h2>
    <p>{{ t("一个密码管理这个小世界。修改后，其他浏览器需要重新登录。") }}</p>
    <form @submit.prevent="save">
      <label
        >{{ t("当前密码")
        }}<input
          v-model="currentPassword"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          required
      /></label>
      <label
        >{{ t("新密码")
        }}<input
          v-model="password"
          name="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="256"
          required
      /></label>
      <label
        >{{ t("确认密码")
        }}<input
          v-model="confirmation"
          name="confirmNewPassword"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="256"
          required
      /></label>
      <div class="row">
        <button class="primary" :disabled="busy">{{ t("修改密码") }}</button
        ><button type="button" @click="signOut">{{ t("退出登录") }}</button>
      </div>
    </form>
  </section>
</template>
<style scoped>
.password-settings {
  margin-top: 24px;
}
form {
  display: grid;
  gap: 16px;
  max-width: 520px;
}
label {
  display: grid;
  gap: 8px;
}
input {
  width: 100%;
  box-sizing: border-box;
}
</style>
