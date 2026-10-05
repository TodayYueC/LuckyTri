<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { access, checkAccess, signIn } from "../access";
import { t } from "../i18n";
import LocaleSwitch from "./shell/LocaleSwitch.vue";
const setup = computed(() => access.phase === "setup");
const password = ref("");
const confirmation = ref("");
const error = ref("");
const busy = ref(false);
async function check() {
  error.value = "";
  try {
    await checkAccess();
  } catch {
    error.value = t("暂时无法连接，请重试");
  }
}
onMounted(check);
async function submit() {
  if (busy.value) return;
  error.value = "";
  if (setup.value && password.value !== confirmation.value) {
    error.value = t("两次输入的密码不一致");
    return;
  }
  busy.value = true;
  try {
    await signIn(password.value);
    password.value = "";
    confirmation.value = "";
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <slot v-if="access.phase === 'ready'" />
  <main v-else class="access-gate">
    <div class="access-language"><LocaleSwitch /></div>
    <section class="access-card">
      <div class="access-orb" aria-hidden="true">✦</div>
      <p class="eyebrow">LuckyTri</p>
      <h1>{{ setup ? t("为这个小世界设置密码") : t("欢迎回来") }}</h1>
      <p v-if="access.phase === 'checking'">{{ t("正在连接小世界…") }}</p>
      <template v-else>
        <p>
          {{
            setup
              ? t("只需设置一个管理密码，以后用它登录。")
              : t("输入管理密码，继续陪伴 TA。")
          }}
        </p>
        <form class="access-form" @submit.prevent="submit">
          <label
            >{{ t("管理密码") }}
            <input
              v-model="password"
              name="managementPassword"
              type="password"
              :autocomplete="setup ? 'new-password' : 'current-password'"
              minlength="8"
              maxlength="256"
              required
              autofocus
            />
          </label>
          <label v-if="setup"
            >{{ t("确认密码") }}
            <input
              v-model="confirmation"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              maxlength="256"
              required
            />
          </label>
          <small v-if="setup">{{
            t("至少 8 个字符。密码只保存在本机的加密校验记录中。")
          }}</small>
          <p v-if="error" class="access-error" role="alert">{{ error }}</p>
          <button class="primary" :disabled="busy">
            {{ busy ? t("请稍候…") : setup ? t("设置密码并进入") : t("登录") }}
          </button>
        </form>
      </template>
      <template v-if="error && access.phase === 'checking'">
        <p class="access-error" role="alert">{{ error }}</p>
        <button class="primary" @click="check">{{ t("重试") }}</button>
      </template>
    </section>
  </main>
</template>

<style scoped>
.access-gate {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 72px 24px;
  background:
    radial-gradient(circle at 25% 20%, #dbe7ec 0, transparent 45%),
    radial-gradient(circle at 85% 70%, #efdfdd 0, transparent 45%), #f4f5ef;
}
.access-language {
  position: absolute;
  top: 22px;
  right: 24px;
}
.access-card {
  width: min(100%, 420px);
  padding: 36px;
  border: 1px solid #fff;
  border-radius: 28px;
  background: #ffffffe0;
  box-shadow: 0 24px 70px #69838618;
}
.access-card h1 {
  font-size: 26px;
  margin: 14px 0;
}
.access-card > p {
  line-height: 1.8;
  color: var(--muted);
}
.access-orb {
  display: grid;
  place-items: center;
  width: 70px;
  height: 70px;
  border-radius: 50%;
  font-size: 32px;
  color: #8b889c;
  background: radial-gradient(circle at 35% 30%, #fff, #e5dde8 60%, #cedfd8);
  margin-bottom: 24px;
}
.access-form,
.access-form label {
  display: grid;
  gap: 12px;
}
.access-form {
  margin-top: 28px;
  gap: 20px;
}
.access-form input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid #d6deda;
  border-radius: 12px;
  background: #fff;
  font: inherit;
}
.access-form small {
  color: var(--muted);
  line-height: 1.7;
}
.access-form button {
  min-height: 44px;
}
.access-error {
  color: #b34e5b;
  font-size: 13px;
}
</style>
