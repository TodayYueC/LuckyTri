<script setup lang="ts">
import { intlLocale, t } from "../../i18n";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { api, toast } from "../../api";
import { ask } from "../../dialog";
import { reload, studio } from "../../stores/studio";
import {
  cancelChatGptSignIn,
  completeChatGptSignIn,
  confirmChatGptFirstUse,
  deleteModel,
  getChatGptAuthStatus,
  importChatGptTransfer,
  listChatGptModels,
  removeChatGptAccount,
  saveModels,
  selectChatGptAccount,
  signOutChatGptAccount,
  startChatGptSignIn,
  testSavedModel,
  updateChatGptSettings,
} from "../../plates/models";
import Sheet from "../../components/ui/Sheet.vue";
import Empty from "../../components/ui/Empty.vue";
import Select from "../../components/ui/Select.vue";

const catalog = computed(() => studio.health?.modelCatalog || []);
const effortLabels = computed(
  () =>
    (studio.health?.effortLabels || {
      none: t("关闭"),
      minimal: t("极低"),
      low: t("低"),
      medium: t("中"),
      high: t("高"),
      xhigh: t("极高"),
      max: t("最深"),
    }) as Record<string, string>,
);
const modelList = ref(studio.core.models.map((m: any) => ({ ...m })));
const index = ref(modelList.value.length ? 0 : -1);
const expandedSavedVendor = ref(
  modelList.value.length ? modelVendor(modelList.value[0]) : "",
);
const busy = ref(false);
const testing = ref(false);
const picker = ref(false);
const editorOpen = ref(false);
async function closeEditor() {
  if (!(await discardDraft())) return;
  modelList.value = studio.core.models.map((model: any) => ({ ...model }));
  index.value = modelList.value.findIndex(
    (model: any) => model.id === draft.id,
  );
  Object.assign(draft, blank(), modelList.value[index.value], { apiKey: "" });
  editorOpen.value = false;
}
const catalogSearch = ref("");
const testResult = ref("");
const tokenUsage = ref<any>(null);
const usageBusy = ref(false);
const usageError = ref("");
const chatgptStatus = ref<any>(
  studio.core?.chatgptAuth || studio.health?.chatgptAuth || null,
);
const chatgptBusy = ref(false);
const chatgptModels = ref<any[]>([]);
const chatgptModelsBusy = ref(false);
const chatgptModelsError = ref("");
const chatgptModelsNotice = ref("");
const pendingAuthorizeUrl = ref("");
const remoteCallbackUrl = ref("");
const remoteCallbackBusy = ref(false);
const remoteCallbackError = ref("");
const transferInput = ref("");
const transferBusy = ref(false);
let authPollTimer: ReturnType<typeof setInterval> | null = null;
const isBrowserLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
  location.hostname.toLowerCase(),
);
const draft = reactive<any>(blank());
if (modelList.value[0])
  Object.assign(draft, modelList.value[0], { apiKey: "" });

const chatgptAccounts = computed<any[]>(
  () => chatgptStatus.value?.accounts || [],
);
const activeChatGptAccount = computed<any>(() => {
  const accounts = chatgptAccounts.value;
  if (!accounts.length) return null;
  const activeId = chatgptStatus.value?.activeAccountId;
  return (
    accounts.find((item: any) => item.accountId === activeId) || accounts[0]
  );
});
const chatgptPending = computed(() =>
  chatgptStatus.value?.pendingAuth?.status === "pending"
    ? chatgptStatus.value.pendingAuth
    : null,
);
const isRemoteStudio = computed(
  () =>
    !isBrowserLoopback ||
    chatgptStatus.value?.localClient === false ||
    chatgptPending.value?.remoteClient === true,
);
const sshForwardCommand = computed(() => {
  const port = chatgptPending.value?.callbackPort;
  if (!port) return "";
  const host =
    !isBrowserLoopback && location.hostname
      ? location.hostname
      : "<server-host>";
  return `ssh -N -L ${port}:127.0.0.1:${port} ${host}`;
});
const remoteCallbackFormatState = computed(() => {
  const raw = remoteCallbackUrl.value.trim();
  const expectedUri = chatgptPending.value?.redirectUri || "";
  if (!raw || !expectedUri) return "empty";
  try {
    const parsed = new URL(raw);
    const expected = new URL(expectedUri);
    if (
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === expected.port &&
      parsed.pathname === "/auth/callback" &&
      !parsed.username &&
      !parsed.password &&
      (parsed.searchParams.has("code") || parsed.searchParams.has("error")) &&
      parsed.searchParams.has("state")
    ) {
      return "match";
    }
    return "mismatch";
  } catch {
    return "mismatch";
  }
});
const chatgptUsageUrl = computed(
  () => chatgptStatus.value?.usageUrl || "https://chatgpt.com/settings/usage",
);
const isDraftChatGpt = computed(
  () =>
    draft.authMode === "chatgpt-oauth" ||
    String(draft.provider || "").toLowerCase() === "openai-chatgpt",
);

function isChatGptModel(model: any) {
  return (
    model?.authMode === "chatgpt-oauth" ||
    String(model?.provider || "").toLowerCase() === "openai-chatgpt"
  );
}

function accountForProfile(model: any) {
  if (!isChatGptModel(model)) return null;
  const accounts = chatgptAccounts.value;
  if (!accounts.length) return null;
  const targetId = String(model?.oauthAccountId || "").trim();
  if (targetId)
    return accounts.find((item: any) => item.accountId === targetId) || null;
  return activeChatGptAccount.value;
}

function isChatGptProfileReady(model: any) {
  const account = accountForProfile(model);
  return Boolean(
    account &&
    account.hasTokens &&
    account.planUsageEnabled &&
    !account.needsReauth,
  );
}

function chatGptAccountLabel(account: any) {
  if (!account) return "";
  return account.email || account.name || account.label || account.accountId;
}

function chatGptStatusLabel(account: any) {
  if (!account) return t("未连接");
  if (!account.hasTokens || account.needsReauth) return t("需要重新登录");
  if (!account.planUsageEnabled) return t("需要重新授权");
  if (account.lastUsageLimitAt) return t("额度受限");
  return t("已连接");
}

function chatGptStatusTone(account: any) {
  if (!account) return "muted";
  if (!account.hasTokens || account.needsReauth) return "warn";
  if (!account.planUsageEnabled) return "warn";
  if (account.lastUsageLimitAt) return "warn";
  return "ok";
}

function stopAuthPolling() {
  if (authPollTimer) {
    clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

async function loadChatGptStatus(silent = true) {
  try {
    const status = await getChatGptAuthStatus();
    chatgptStatus.value = status;
    if (!status?.pendingAuth) {
      pendingAuthorizeUrl.value = "";
      remoteCallbackUrl.value = "";
      remoteCallbackError.value = "";
      stopAuthPolling();
    }
  } catch (error) {
    if (!silent) toast((error as Error).message, true);
  }
}

function startAuthPolling() {
  stopAuthPolling();
  authPollTimer = setInterval(async () => {
    const hadPending = Boolean(chatgptStatus.value?.pendingAuth);
    await loadChatGptStatus(true);
    if (hadPending && !chatgptStatus.value?.pendingAuth) {
      await reload();
      if (activeChatGptAccount.value?.hasTokens) {
        toast(t("ChatGPT 订阅连接已更新"));
      }
    }
  }, 2500);
}

async function beginChatGptSignIn(
  mode: "new" | "reauth" | "reconsent" = "new",
  accountId = "",
) {
  if (chatgptBusy.value) return;
  chatgptBusy.value = true;
  remoteCallbackUrl.value = "";
  remoteCallbackError.value = "";
  try {
    const requestLocal =
      isBrowserLoopback && chatgptStatus.value?.localClient !== false;
    const result = await startChatGptSignIn({
      mode,
      accountId,
      openBrowser: requestLocal,
    });
    chatgptStatus.value = result.status;
    pendingAuthorizeUrl.value = result.authorizeUrl || "";
    startAuthPolling();
    const remote =
      !isBrowserLoopback ||
      result.localClient === false ||
      result.remoteClient === true;
    if (!remote && !result.browserOpened && result.authorizeUrl) {
      window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
    }
    toast(
      remote
        ? t("已创建远程授权会话，请按下方步骤完成授权并粘贴回调链接")
        : t("请在浏览器完成 ChatGPT 授权"),
    );
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    chatgptBusy.value = false;
  }
}

async function submitRemoteCallback() {
  const pendingId = String(chatgptPending.value?.id || "").trim();
  const callbackUrl = remoteCallbackUrl.value.trim();
  if (!pendingId || !callbackUrl || remoteCallbackBusy.value) return;
  remoteCallbackBusy.value = true;
  remoteCallbackError.value = "";
  try {
    const result = await completeChatGptSignIn({ pendingId, callbackUrl });
    remoteCallbackUrl.value = "";
    pendingAuthorizeUrl.value = "";
    chatgptStatus.value = result.status;
    stopAuthPolling();
    await reload();
    toast(
      result.planUsageEnabled
        ? t("ChatGPT 订阅认证已完成")
        : t("已完成身份登录，但尚未授予订阅调用权限"),
    );
  } catch (error) {
    const message = (error as Error).message || t("回调校验失败，请重试");
    remoteCallbackError.value = message;
    toast(message, true);
  } finally {
    remoteCallbackBusy.value = false;
  }
}

async function cancelPendingSignIn() {
  if (chatgptBusy.value) return;
  chatgptBusy.value = true;
  try {
    const result = await cancelChatGptSignIn();
    chatgptStatus.value = result.status;
    pendingAuthorizeUrl.value = "";
    remoteCallbackUrl.value = "";
    remoteCallbackError.value = "";
    stopAuthPolling();
    toast(t("已取消本次 ChatGPT 登录"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    chatgptBusy.value = false;
  }
}

async function copyPendingUrl() {
  if (!pendingAuthorizeUrl.value) return;
  try {
    await navigator.clipboard.writeText(pendingAuthorizeUrl.value);
    toast(t("授权链接已复制"));
  } catch {
    toast(t("无法自动复制，请手动点击打开授权页"), true);
  }
}

async function copySshForwardCommand() {
  if (!sshForwardCommand.value) return;
  try {
    await navigator.clipboard.writeText(sshForwardCommand.value);
    toast(t("SSH 端口转发命令已复制"));
  } catch {
    toast(t("无法自动复制，请手动选中命令复制"), true);
  }
}

async function chooseActiveChatGptAccount(event: Event) {
  const accountId = (event.target as HTMLSelectElement).value;
  if (!accountId) return;
  try {
    const result = await selectChatGptAccount(accountId);
    chatgptStatus.value = result.status;
    chatgptModels.value = [];
    toast(t("已切换默认 ChatGPT 订阅账号"));
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function acknowledgeFirstSignIn() {
  try {
    const result = await confirmChatGptFirstUse();
    chatgptStatus.value = result.status;
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function toggleChatGptSetting(
  key: "allowBackgroundUse" | "allowPaidFallback",
  event: Event,
) {
  const checked = (event.target as HTMLInputElement).checked;
  try {
    const result = await updateChatGptSettings({ [key]: checked });
    chatgptStatus.value = result.status;
    toast(t("ChatGPT 订阅策略已更新"));
  } catch (error) {
    toast((error as Error).message, true);
    await loadChatGptStatus(true);
  }
}

async function disconnectChatGpt(accountId = "") {
  if (
    !(await ask(
      t(
        "断开此 ChatGPT 订阅账号的本机登录令牌？已保存的模型档案不会删除，之后可重新登录。",
      ),
      {
        title: t("断开 ChatGPT 订阅"),
        confirmText: t("断开登录"),
        cancelText: t("取消"),
      },
    ))
  )
    return;
  chatgptBusy.value = true;
  try {
    const result = await signOutChatGptAccount(accountId);
    chatgptStatus.value = result.status;
    chatgptModels.value = [];
    await reload();
    toast(
      result.remoteRevoked
        ? t("已断开登录并撤销远端令牌")
        : t(
            "已清除本机登录令牌；如需彻底解除授权，请到 ChatGPT 设置 → Apps 中移除 LuckyTri",
          ),
    );
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    chatgptBusy.value = false;
  }
}

async function forgetChatGptAccount(accountId: string) {
  if (
    !(await ask(t("确定彻底移除这个 ChatGPT 订阅账号记录？"), {
      title: t("移除订阅账号"),
      confirmText: t("移除"),
      danger: true,
    }))
  )
    return;
  chatgptBusy.value = true;
  try {
    const result = await removeChatGptAccount(accountId);
    chatgptStatus.value = result.status;
    chatgptModels.value = [];
    await reload();
    toast(t("已移除该 ChatGPT 订阅账号"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    chatgptBusy.value = false;
  }
}

async function fetchAccountModels() {
  if (chatgptModelsBusy.value) return;
  chatgptModelsBusy.value = true;
  chatgptModelsError.value = "";
  chatgptModelsNotice.value = "";
  try {
    const res = await listChatGptModels(
      activeChatGptAccount.value?.accountId || "",
    );
    chatgptModels.value = Array.isArray(res.models) ? res.models : [];
    chatgptModelsNotice.value = t(
      "已拉取 {count} 个账号列出模型。目录仅表示当前可见列表，最终可用性与额度仍以调用时的订阅校验为准。",
      { count: chatgptModels.value.length },
    );
  } catch (error) {
    chatgptModelsError.value = (error as Error).message;
  } finally {
    chatgptModelsBusy.value = false;
  }
}

async function createProfileFromLiveModel(item: any) {
  if (!(await discardDraft())) return;
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  const ctx =
    Number(item.contextWindow) >= 8192 ? Number(item.contextWindow) : 400000;
  const maxOut = Math.min(128000, Math.floor(ctx / 3));
  const row = {
    ...blank(),
    id: "model-" + Date.now(),
    vendor: t("ChatGPT 订阅"),
    label: t("{name}（ChatGPT 订阅）", {
      name: item.displayName || item.slug,
    }),
    provider: "openai-chatgpt",
    authMode: "chatgpt-oauth",
    oauthAccountId: activeChatGptAccount.value?.accountId || "",
    baseUrl: "https://api.openai.com/v1",
    model: item.slug,
    apiProtocol: "responses",
    apiKey: "",
    hasApiKey: false,
    contextWindow: ctx,
    maxInputTokens: ctx - maxOut,
    maxOutputTokens: maxOut,
    vision: true,
    system: true,
    json: true,
    tools: true,
    embedding: false,
    embeddingModel: "",
    thinkingStyle: "openai",
    tokenField: "max_completion_tokens",
    omitSampling: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    reasoningEffort: "medium",
    temperature: 1,
    topP: 1,
    timeoutMs: 120000,
    isDefault: modelList.value.length === 0,
    enabled: true,
  };
  modelList.value.push(row);
  index.value = modelList.value.length - 1;
  expandedSavedVendor.value = modelVendor(row);
  Object.assign(draft, row);
  testResult.value = "";
  editorOpen.value = true;
  studio.dirty = true;
}

async function submitTransferImport() {
  const raw = transferInput.value.trim();
  if (!raw || transferBusy.value) return;
  transferBusy.value = true;
  try {
    const result = await importChatGptTransfer(raw);
    chatgptStatus.value = result.status;
    transferInput.value = "";
    await reload();
    toast(t("已导入本地迁移凭据，本机 host ID 已保留"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    transferBusy.value = false;
  }
}

const editing = computed(() => index.value >= 0 && !!draft.id);
const groups = computed(() => {
  const rows: { vendor: string; models: any[] }[] = [];
  for (const item of catalog.value) {
    if (item.id === "custom") continue;
    let group = rows.find((row) => row.vendor === item.vendor);
    if (!group) {
      group = { vendor: item.vendor, models: [] };
      rows.push(group);
    }
    group.models.push(item);
  }
  return rows;
});
const filteredGroups = computed(() => {
  const query = catalogSearch.value.trim().toLocaleLowerCase();
  if (!query) return groups.value;
  return groups.value
    .map((group) => ({
      ...group,
      models: group.models.filter((item: any) =>
        [group.vendor, item.label, item.model, item.summary]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
      ),
    }))
    .filter((group) => group.models.length);
});
const savedGroups = computed(() => {
  const rows: { vendor: string; models: { model: any; index: number }[] }[] =
    [];
  modelList.value.forEach((model: any, modelIndex: number) => {
    const vendor = modelVendor(model);
    let group = rows.find((row) => row.vendor === vendor);
    if (!group) {
      group = { vendor, models: [] };
      rows.push(group);
    }
    group.models.push({ model, index: modelIndex });
  });
  return rows;
});
const customPreset = computed(() =>
  catalog.value.find((item: any) => item.id === "custom"),
);
const vendorModels = computed(() =>
  catalog.value.filter(
    (item: any) => item.vendor && item.vendor === draft.vendor,
  ),
);
const draftPreset = computed(
  () =>
    catalog.value.find((item: any) => item.id === draft.presetId) ||
    catalog.value.find(
      (item: any) =>
        item.model &&
        item.model === draft.model &&
        item.baseUrl === draft.baseUrl,
    ),
);
const contextOptions = computed(() => {
  const windows = draftPreset.value?.contextWindows || [];
  if (windows.length < 2) return [];
  const current = Number(draft.contextWindow);
  if (windows.some((item: any) => item.contextWindow === current))
    return windows;
  return [
    ...windows,
    {
      label: t("已保存 {value}", { value: formatTokens(current) }),
      contextWindow: current,
      maxInputTokens: Number(draft.maxInputTokens),
      maxOutputTokens: Number(draft.maxOutputTokens),
    },
  ];
});
const effortOptions = computed(() => {
  const list =
    Array.isArray(draft.reasoningEfforts) && draft.reasoningEfforts.length
      ? [...draft.reasoningEfforts]
      : ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (draft.reasoningEffort && !list.includes(draft.reasoningEffort))
    list.unshift(draft.reasoningEffort);
  return list;
});
const hasSavedProfile = computed(() =>
  studio.core.models.some((m: any) => m.id === draft.id),
);

function blank() {
  return {
    id: "",
    presetId: "",
    label: "",
    provider: "",
    vendor: "",
    authMode: "api-key",
    oauthAccountId: "",
    apiProtocol: "chat",
    baseUrl: "",
    model: "",
    apiKey: "",
    hasApiKey: false,
    contextWindow: 128000,
    maxInputTokens: 119808,
    maxOutputTokens: 8192,
    vision: false,
    system: true,
    json: true,
    tools: false,
    embedding: false,
    embeddingModel: "",
    reasoningEffort: "none",
    reasoningEfforts: ["none", "low", "medium", "high"],
    thinkingStyle: "openai",
    tokenField: "max_tokens",
    omitSampling: false,
    temperature: 0.85,
    topP: 1,
    timeoutMs: 90000,
    isDefault: false,
    enabled: true,
  };
}

function modelVendor(model: any) {
  const providerLabels: Record<string, string> = {
    "openai-chatgpt": t("ChatGPT 订阅"),
    "volcengine-agent-plan": t("火山方舟 Agent Plan"),
    "volcengine-coding-plan": t("火山方舟 Coding Plan"),
    "opencode-go": "OpenCode Go",
    "opencode-zen": "OpenCode Zen",
    deepseek: "DeepSeek",
    openai: "OpenAI",
    gemini: "Gemini",
    google: "Gemini",
    anthropic: "Claude",
    claude: "Claude",
    bedrock: t("亚马逊 Bedrock"),
    qwen: t("通义千问"),
    moonshot: "Kimi",
    kimi: "Kimi",
    zhipu: t("智谱 GLM"),
    glm: t("智谱 GLM"),
    mimo: t("小米 MiMo"),
    siliconflow: "SiliconFlow",
    openrouter: "OpenRouter",
  };
  return (
    String(model?.vendor || "").trim() ||
    providerLabels[String(model?.provider || "").toLowerCase()] ||
    String(model?.provider || t("自定义供应商"))
  );
}

function toggleSavedVendor(vendor: string, event: Event) {
  const details = event.currentTarget as HTMLDetailsElement;
  expandedSavedVendor.value = details.open ? vendor : "";
}

function presetFields(preset: any) {
  const { summary: _summary, contextWindows: _windows, ...fields } = preset;
  return { ...fields, presetId: preset.id };
}

function withoutWindows(model: any) {
  const { contextWindows: _windows, ...rest } = model;
  return rest;
}

function fitBudget(profile: any) {
  let context = Number(profile.contextWindow);
  let output = Number(profile.maxOutputTokens);
  let input = Number(profile.maxInputTokens);
  if (!Number.isFinite(context) || context < 2) context = 2;
  if (!Number.isFinite(output) || output < 1) output = 1;
  if (output >= context) output = context - 1;
  if (!Number.isFinite(input) || input < 1) input = context - output;
  if (input + output > context) input = context - output;
  return {
    contextWindow: context,
    maxInputTokens: input,
    maxOutputTokens: output,
  };
}

function applyContextWindow(event: Event) {
  const selected = Number((event.target as HTMLSelectElement).value);
  const option = contextOptions.value.find(
    (item: any) => item.contextWindow === selected,
  );
  if (!option) return;
  draft.contextWindow = option.contextWindow;
  draft.maxInputTokens = option.maxInputTokens;
  draft.maxOutputTokens = option.maxOutputTokens;
  studio.dirty = true;
}

// Vendors publish both decimal (128,000) and binary (131,072) ceilings and
// call both "128K", so show whichever reading gives a whole number.
function formatTokens(value: number) {
  const n = Number(value) || 0;
  if (n >= 1000000)
    return (
      (n % 1048576 === 0 ? n / 1048576 : Number((n / 1000000).toFixed(2))) + "M"
    );
  if (n >= 1000)
    return (
      (n % 1000 === 0
        ? n / 1000
        : n % 1024 === 0
          ? n / 1024
          : Math.round(n / 1000)) + "K"
    );
  return String(n);
}

function capacity(item: any) {
  if (item.id === "openrouter") return t("按所选模型填写上下文和输出参数");
  if (!item.model) return t("填写模型 ID 和对应参数");
  const windows = item.contextWindows || [];
  const context = windows.length
    ? windows.map((w: any) => w.label).join(" / ")
    : formatTokens(item.contextWindow);
  return t("上下文 {context} · 输出 {v}", {
    context,
    v: formatTokens(item.maxOutputTokens),
  });
}

function effortName(value: string) {
  if (["mimo", "qwen", "kimi-toggle"].includes(draft.thinkingStyle))
    return value === "none" ? t("关闭") : t("开启");
  return `${effortLabels.value[value] || value} / ${value}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat(intlLocale()).format(Number(value) || 0);
}

async function loadUsage() {
  if (usageBusy.value) return;
  usageBusy.value = true;
  try {
    tokenUsage.value = await api("/core/usage");
    usageError.value = "";
  } catch (error) {
    usageError.value = (error as Error).message;
  } finally {
    usageBusy.value = false;
  }
}

onMounted(() => {
  void loadUsage();
  void loadChatGptStatus(true);
});
onBeforeUnmount(() => {
  stopAuthPolling();
  pendingAuthorizeUrl.value = "";
  remoteCallbackUrl.value = "";
});
watch(
  () => studio.tick,
  () => {
    void loadUsage();
    void loadChatGptStatus(true);
  },
);

async function discardDraft() {
  if (!studio.dirty) return true;
  if (
    !(await ask(t("放弃当前模型草稿？"), {
      title: t("草稿还没保存"),
      confirmText: t("放弃"),
      cancelText: t("留下"),
    }))
  )
    return false;
  studio.dirty = false;
  return true;
}

async function select(i: number) {
  const next = modelList.value[i];
  if (!next) return;
  if (next.id === draft.id && editorOpen.value) return;
  if (!(await discardDraft())) return;
  modelList.value = modelList.value.filter(
    (m: any) =>
      m.id === next.id ||
      studio.core.models.some((saved: any) => saved.id === m.id),
  );
  index.value = modelList.value.findIndex((m: any) => m.id === next.id);
  editorOpen.value = true;
  expandedSavedVendor.value = modelVendor(next);
  Object.assign(draft, blank(), next, { apiKey: "" });
  testResult.value = "";
}

async function openPicker() {
  if (!(await discardDraft())) return;
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  if (!modelList.value.length) {
    index.value = -1;
    Object.assign(draft, blank());
  } else if (!modelList.value.some((m: any) => m.id === draft.id)) {
    index.value = 0;
    Object.assign(draft, blank(), modelList.value[0], { apiKey: "" });
  }
  const selected = modelList.value[index.value] || modelList.value[0];
  expandedSavedVendor.value = selected ? modelVendor(selected) : "";
  catalogSearch.value = "";
  picker.value = true;
}

function choosePreset(preset: any) {
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  const row = {
    ...blank(),
    ...presetFields(preset),
    id: "model-" + Date.now(),
    apiKey: "",
    hasApiKey: false,
    oauthAccountId:
      preset.authMode === "chatgpt-oauth"
        ? activeChatGptAccount.value?.accountId || ""
        : "",
    isDefault: modelList.value.length === 0,
  };
  modelList.value.push(row);
  index.value = modelList.value.length - 1;
  expandedSavedVendor.value = modelVendor(row);
  Object.assign(draft, row);
  testResult.value = "";
  picker.value = false;
  editorOpen.value = true;
  studio.dirty = true;
}

function switchPreset(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const preset = catalog.value.find((item: any) => item.id === id);
  if (!preset) return;
  Object.assign(draft, blank(), presetFields(preset), {
    id: draft.id,
    apiKey: draft.apiKey,
    hasApiKey: draft.hasApiKey,
    isDefault: draft.isDefault,
  });
  const current = modelList.value[index.value];
  if (current) current.label = draft.label;
  studio.dirty = true;
}

function makeDefault() {
  for (const model of modelList.value) model.isDefault = model.id === draft.id;
  draft.isDefault = true;
  studio.dirty = true;
}

async function save() {
  const fitted = fitBudget(draft);
  const chatGptDraft = isDraftChatGpt.value;
  const models = modelList.value.map((m: any, i: number) =>
    withoutWindows(
      i === index.value
        ? {
            ...draft,
            ...fitted,
            ...(chatGptDraft
              ? {
                  authMode: "chatgpt-oauth",
                  apiProtocol: "responses",
                  baseUrl: "https://api.openai.com/v1",
                  apiKey: "",
                  omitSampling: true,
                  embedding: false,
                }
              : {}),
            isDefault: !!draft.isDefault,
            enabled: draft.isDefault ? true : draft.enabled !== false,
            timeoutMs: Number(draft.timeoutMs),
            temperature: Number(draft.temperature),
            topP: Number(draft.topP),
          }
        : { ...m, isDefault: !!m.isDefault && m.id !== draft.id },
    ),
  );
  if (!models.some((m: any) => m.isDefault) && models.length)
    models[0].isDefault = true;
  if (busy.value) return;
  busy.value = true;
  try {
    await saveModels(models);
    studio.dirty = false;
    await reload();
    modelList.value = studio.core.models.map((m: any) => ({ ...m }));
    Object.assign(draft, blank(), modelList.value[index.value], { apiKey: "" });
    toast(t("已保存并应用"));
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (
    !(await ask(t("确定删除这个模型？"), {
      title: t("删除模型"),
      confirmText: t("删除"),
      danger: true,
    }))
  )
    return;
  if (studio.core.models.some((m: any) => m.id === draft.id))
    await deleteModel(draft.id);
  studio.dirty = false;
  await reload();
  modelList.value = studio.core.models.map((m: any) => ({ ...m }));
  testResult.value = "";
  editorOpen.value = false;
  if (!modelList.value.length) {
    index.value = -1;
    expandedSavedVendor.value = "";
    Object.assign(draft, blank());
    return;
  }
  index.value = 0;
  expandedSavedVendor.value = modelVendor(modelList.value[0]);
  Object.assign(draft, blank(), modelList.value[0], { apiKey: "" });
}

async function testModel() {
  if (!hasSavedProfile.value || studio.dirty || testing.value) return;
  testing.value = true;
  testResult.value = t("正在测试「{v}」…", { v: draft.label || draft.model });
  try {
    const r = await testSavedModel(draft.id);
    testResult.value = t("✓ {v} 连接成功 · {latency} ms", {
      v: draft.label || r.model,
      latency: r.latency,
    });
    await reload();
  } catch (error) {
    testResult.value = (error as Error).message;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="library">
    <div class="model-workspace">
      <aside class="card shelf">
        <div class="shelf-head">
          <h2>
            {{ t("模型库") }} <small>{{ modelList.length }}</small>
          </h2>
          <button id="addModel" class="small primary" @click="openPicker">
            {{ t("＋ 新增模型") }}
          </button>
        </div>
        <p class="faint">
          {{
            t(
              "群聊、私聊和独处都使用默认模型。其余已启用的模型按这里的顺序作为备用。关掉的模型不会被调用。",
            )
          }}
        </p>
        <div class="model-card-grid">
          <button
            v-for="(model, i) in modelList"
            :key="model.id"
            class="model-card"
            @click="select(i)"
          >
            <span class="model-card-icon">{{
              String(model.label || model.model || "?")
                .slice(0, 1)
                .toUpperCase()
            }}</span>
            <span class="model-card-title"
              ><b>{{ model.label || model.model }}</b
              ><small>{{ modelVendor(model) }}</small></span
            >
            <span class="chip">{{
              model.enabled === false
                ? t("已关闭")
                : model.isDefault
                  ? t("默认模型")
                  : t("备用模型")
            }}</span>
            <small>{{
              isChatGptModel(model)
                ? isChatGptProfileReady(model)
                  ? t("订阅已连接")
                  : t("待连接 ChatGPT 订阅")
                : model.hasApiKey
                  ? t("密钥已保存")
                  : t("待填写密钥")
            }}</small>
          </button>
          <Empty
            v-if="!modelList.length"
            :title="t('还没有模型')"
            :text="
              t(
                '常见厂商会预填模型参数；OpenRouter 可选 GPT-6 预设，也可用自选模型手动填写模型 ID 和参数。',
              )
            "
          />
        </div>
      </aside>

      <section
        id="chatgptSubscriptionCard"
        class="card chatgpt-sub-panel"
        aria-labelledby="chatgpt-sub-title"
      >
        <div class="card-head">
          <div>
            <span class="eyebrow">SIGN IN WITH CHATGPT</span>
            <h2 id="chatgpt-sub-title">{{ t("ChatGPT 订阅入口") }}</h2>
          </div>
          <span
            class="chip"
            :data-tone="chatGptStatusTone(activeChatGptAccount)"
            >{{ chatGptStatusLabel(activeChatGptAccount) }}</span
          >
        </div>

        <p class="faint">
          {{
            t(
              "与现有 API Key 供应商并列，通过官方 Sign in with ChatGPT 和直连 Responses API（store=false、stream=true）为你的自用机器人提供调用入口，不用于共享额度或对外代理。",
            )
          }}
        </p>

        <div
          v-if="
            activeChatGptAccount &&
            activeChatGptAccount.planUsageEnabled &&
            chatgptStatus &&
            !chatgptStatus.firstSignInConfirmed
          "
          class="notice chatgpt-banner"
          role="status"
        >
          <div>
            <strong>{{ t("正在使用你的 ChatGPT 订阅") }}</strong>
            <p class="faint">
              {{
                t(
                  "调用消耗你本人的 ChatGPT 订阅共享滚动额度（与 ChatGPT 网页和应用共享，并非无限或独立额度），可在 ChatGPT 用量设置中随时查看或撤销授权。",
                )
              }}
            </p>
          </div>
          <button
            type="button"
            class="small primary"
            @click="acknowledgeFirstSignIn"
          >
            {{ t("知道了") }}
          </button>
        </div>

        <div
          v-if="activeChatGptAccount?.lastUsageLimitAt"
          class="notice chatgpt-warn"
          role="alert"
        >
          <div>
            <strong>{{ t("ChatGPT 订阅额度已达上限") }}</strong>
            <p class="faint">
              {{
                t(
                  "当前共享滚动额度已用尽，调用已暂停。不会自动切换其他 ChatGPT 账号，也不会在未同意时切到付费 API Key。",
                )
              }}
            </p>
          </div>
          <a
            :href="chatgptUsageUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="usage-link primary-link"
            >{{ t("前往 ChatGPT 管理用量 ↗") }}</a
          >
        </div>

        <div
          v-if="
            activeChatGptAccount &&
            (!activeChatGptAccount.hasTokens ||
              activeChatGptAccount.needsReauth)
          "
          class="notice chatgpt-warn"
          role="alert"
        >
          <div>
            <strong>{{ t("ChatGPT 订阅登录已失效") }}</strong>
            <p class="faint">
              {{
                t(
                  "请重新通过官方登录恢复调用；已保存的模型档案与本机 host ID 会保留。",
                )
              }}
            </p>
          </div>
          <button
            type="button"
            class="small primary"
            data-oai-siwc-button
            :data-oai-siwc-button-client="activeChatGptAccount.clientId"
            :disabled="chatgptBusy"
            @click="
              beginChatGptSignIn('reauth', activeChatGptAccount.accountId)
            "
          >
            {{ t("重新登录") }}
          </button>
        </div>

        <div
          v-else-if="
            activeChatGptAccount &&
            activeChatGptAccount.hasTokens &&
            !activeChatGptAccount.planUsageEnabled
          "
          class="notice chatgpt-warn"
          role="alert"
        >
          <div>
            <strong>{{ t("尚未授予 ChatGPT 订阅用量权限") }}</strong>
            <p class="faint">
              {{
                t(
                  "当前仅完成了身份登录，未授予 chatgpt.tokens.use.direct 权限，暂不能发起模型调用。",
                )
              }}
            </p>
          </div>
          <button
            type="button"
            class="small primary"
            data-oai-siwc-button
            :data-oai-siwc-button-client="activeChatGptAccount.clientId"
            :disabled="chatgptBusy"
            @click="
              beginChatGptSignIn('reconsent', activeChatGptAccount.accountId)
            "
          >
            {{ t("重新授权订阅权限") }}
          </button>
        </div>

        <div v-if="activeChatGptAccount" class="chatgpt-account-bar">
          <div class="chatgpt-account-meta">
            <span class="plan-pill">{{ t("正在使用 ChatGPT 订阅") }}</span>
            <b>{{ chatGptAccountLabel(activeChatGptAccount) }}</b>
          </div>
          <a
            :href="chatgptUsageUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="usage-link"
            >{{ t("管理用量 ↗") }}</a
          >
        </div>

        <div v-if="chatgptAccounts.length > 1" class="chatgpt-account-picker">
          <label>
            {{ t("默认订阅账号") }}
            <Select
              :model-value="activeChatGptAccount?.accountId || ''"
              :aria-label="t('默认订阅账号')"
              :options="
                chatgptAccounts.map((acc: any) => ({
                  value: acc.accountId,
                  label: `${chatGptAccountLabel(acc)} · ${chatGptStatusLabel(acc)}`,
                }))
              "
              @change="chooseActiveChatGptAccount"
            />
          </label>
        </div>

        <div
          v-if="isRemoteStudio && !chatgptPending"
          class="notice chatgpt-remote-tip"
        >
          <strong>{{
            t("当前通过远程地址访问管理台（如 Tailscale / VPS）")
          }}</strong>
          <p class="faint">
            {{
              t(
                "OpenAI 官方要求 OAuth 回调固定为本机 127.0.0.1，不能直接跳回远程域名。点击下方 Continue with ChatGPT 后，浏览器授权结束会跳到 127.0.0.1 并显示无法访问——这是正常现象，按页面指引复制地址栏链接粘贴回此处即可完成认证（也支持 SSH 端口转发或下方本机导出迁移）。",
              )
            }}
          </p>
        </div>

        <div class="chatgpt-actions">
          <button
            id="continueWithChatGpt"
            type="button"
            class="primary siwc-btn"
            data-oai-siwc-button
            :data-oai-siwc-button-client="
              activeChatGptAccount?.clientId || undefined
            "
            :disabled="chatgptBusy || !!chatgptPending"
            @click="
              beginChatGptSignIn(
                activeChatGptAccount && !activeChatGptAccount.hasTokens
                  ? 'reauth'
                  : 'new',
                activeChatGptAccount && !activeChatGptAccount.hasTokens
                  ? activeChatGptAccount.accountId
                  : '',
              )
            "
          >
            Continue with ChatGPT
          </button>
          <button
            v-if="activeChatGptAccount?.planUsageEnabled"
            id="fetchChatGptModels"
            type="button"
            :disabled="chatgptModelsBusy"
            @click="fetchAccountModels"
          >
            {{ chatgptModelsBusy ? t("拉取中…") : t("拉取账号可用模型") }}
          </button>
          <button
            v-if="activeChatGptAccount?.hasTokens"
            type="button"
            :disabled="chatgptBusy"
            @click="disconnectChatGpt(activeChatGptAccount.accountId)"
          >
            {{ t("断开登录") }}
          </button>
          <button
            v-if="activeChatGptAccount"
            type="button"
            class="danger"
            :disabled="chatgptBusy"
            @click="forgetChatGptAccount(activeChatGptAccount.accountId)"
          >
            {{ t("移除账号") }}
          </button>
        </div>

        <div v-if="chatgptPending" class="notice chatgpt-pending" role="status">
          <template v-if="isRemoteStudio">
            <strong>{{ t("远程登录步骤（约 10 分钟内有效）") }}</strong>
            <ol class="chatgpt-remote-steps">
              <li>
                {{
                  t(
                    "点击下方按钮在新标签页打开 ChatGPT 授权并同意。完成后浏览器会跳转到 {uri}?... 并提示「无法访问/拒绝连接」，这是 OpenAI 强制 127.0.0.1 回调（指向你当前设备而非远程服务器）导致的正常现象。",
                    { uri: chatgptPending.redirectUri },
                  )
                }}
              </li>
              <li>
                {{
                  t(
                    "复制该标签页地址栏里的完整回调链接，粘贴到下方输入框并提交，即可在当前远程管理台安全完成令牌交换（不会记录到日志）。",
                  )
                }}
              </li>
            </ol>
            <div class="chatgpt-actions">
              <a
                v-if="pendingAuthorizeUrl"
                :href="pendingAuthorizeUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="usage-link primary-link"
                >{{ t("打开 ChatGPT 授权页 ↗") }}</a
              >
              <button
                v-if="pendingAuthorizeUrl"
                type="button"
                class="small"
                @click="copyPendingUrl"
              >
                {{ t("复制授权链接") }}
              </button>
              <button
                type="button"
                class="small"
                :disabled="chatgptBusy || remoteCallbackBusy"
                @click="cancelPendingSignIn"
              >
                {{ t("取消本次登录") }}
              </button>
            </div>
            <p v-if="!pendingAuthorizeUrl" class="faint">
              {{
                t(
                  "页面刷新后不会重复缓存授权链接；如需重新打开授权页，请先取消本次登录后重新点击 Continue with ChatGPT。",
                )
              }}
            </p>
            <form
              class="chatgpt-callback-form"
              @submit.prevent="submitRemoteCallback"
            >
              <label class="transfer-label" for="chatgptRemoteCallbackInput">
                <span>{{
                  t("粘贴浏览器跳转后的完整回调链接（以 {uri} 开头）", {
                    uri: chatgptPending.redirectUri,
                  })
                }}</span>
                <input
                  id="chatgptRemoteCallbackInput"
                  v-model="remoteCallbackUrl"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="`${chatgptPending.redirectUri}?code=...&state=...`"
                />
              </label>
              <small
                v-if="remoteCallbackFormatState === 'match'"
                class="callback-hint ok"
              >
                {{
                  t("已识别到匹配本次回调端口的官方 127.0.0.1 链接，可以提交。")
                }}
              </small>
              <small
                v-else-if="remoteCallbackFormatState === 'mismatch'"
                class="callback-hint warn"
              >
                {{
                  t(
                    "请确认粘贴的是以 {uri} 开头且包含 code 与 state 参数的完整地址栏链接。",
                    { uri: chatgptPending.redirectUri },
                  )
                }}
              </small>
              <small
                v-if="remoteCallbackError"
                class="callback-hint err"
                role="alert"
              >
                {{ remoteCallbackError }}
              </small>
              <div class="chatgpt-actions">
                <button
                  id="submitChatGptRemoteCallback"
                  type="submit"
                  class="small primary"
                  :disabled="remoteCallbackBusy || !remoteCallbackUrl.trim()"
                >
                  {{
                    remoteCallbackBusy
                      ? t("正在完成认证…")
                      : t("提交回调链接完成认证")
                  }}
                </button>
              </div>
            </form>
            <details v-if="sshForwardCommand" class="chatgpt-ssh-box">
              <summary>
                {{ t("可选：通过 SSH 本地端口转发自动完成回调") }}
              </summary>
              <p class="faint">
                {{
                  t(
                    "如果你正在电脑端操作，也可以先在本地终端运行下方命令，再打开 ChatGPT 授权页；浏览器跳转到 127.0.0.1 时会自动转发至服务器并刷新本页：",
                  )
                }}
              </p>
              <code class="vm-cmd">{{ sshForwardCommand }}</code>
              <div class="chatgpt-actions">
                <button
                  type="button"
                  class="small"
                  @click="copySshForwardCommand"
                >
                  {{ t("复制 SSH 转发命令") }}
                </button>
              </div>
            </details>
          </template>
          <template v-else>
            <p>
              {{
                t(
                  "正在本机临时回调端口等待 ChatGPT 授权完成（约 10 分钟内有效）。完成授权后此页面会自动刷新。",
                )
              }}
            </p>
            <div class="chatgpt-actions">
              <a
                v-if="pendingAuthorizeUrl"
                :href="pendingAuthorizeUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="usage-link primary-link"
                >{{ t("打开 ChatGPT 授权页 ↗") }}</a
              >
              <button
                v-if="pendingAuthorizeUrl"
                type="button"
                class="small"
                @click="copyPendingUrl"
              >
                {{ t("复制授权链接") }}
              </button>
              <button
                type="button"
                class="small"
                :disabled="chatgptBusy || remoteCallbackBusy"
                @click="cancelPendingSignIn"
              >
                {{ t("取消本次登录") }}
              </button>
            </div>
            <details class="chatgpt-ssh-box">
              <summary>
                {{ t("若通过端口转发访问且回调无法自动抵达，可手动粘贴回调链接") }}
              </summary>
              <form
                class="chatgpt-callback-form"
                @submit.prevent="submitRemoteCallback"
              >
                <label class="transfer-label" for="chatgptRemoteCallbackInput">
                  <span>{{
                    t("粘贴浏览器跳转后的完整回调链接（以 {uri} 开头）", {
                      uri: chatgptPending.redirectUri,
                    })
                  }}</span>
                  <input
                    id="chatgptRemoteCallbackInput"
                    v-model="remoteCallbackUrl"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="`${chatgptPending.redirectUri}?code=...&state=...`"
                  />
                </label>
                <small
                  v-if="remoteCallbackError"
                  class="callback-hint err"
                  role="alert"
                >
                  {{ remoteCallbackError }}
                </small>
                <div class="chatgpt-actions">
                  <button
                    id="submitChatGptRemoteCallback"
                    type="submit"
                    class="small primary"
                    :disabled="remoteCallbackBusy || !remoteCallbackUrl.trim()"
                  >
                    {{
                      remoteCallbackBusy
                        ? t("正在完成认证…")
                        : t("提交回调链接完成认证")
                    }}
                  </button>
                </div>
              </form>
            </details>
          </template>
        </div>

        <div class="chatgpt-policies">
          <label class="check policy-check">
            <input
              type="checkbox"
              :checked="chatgptStatus?.settings?.allowBackgroundUse === true"
              @change="toggleChatGptSetting('allowBackgroundUse', $event)"
            />
            <span>
              <b>{{ t("允许后台自主任务使用 ChatGPT 订阅") }}</b>
              <small class="faint">{{
                t(
                  "默认关闭。开启前仅响应对话与手动测试；开启后独处、整理记忆、日记与回顾等后台阶段也可使用你选中的 ChatGPT 订阅模型。",
                )
              }}</small>
            </span>
          </label>
          <label class="check policy-check">
            <input
              type="checkbox"
              :checked="chatgptStatus?.settings?.allowPaidFallback === true"
              @change="toggleChatGptSetting('allowPaidFallback', $event)"
            />
            <span>
              <b>{{ t("订阅失败时允许回退到付费 API Key 备用模型") }}</b>
              <small class="faint">{{
                t(
                  "默认关闭。未开启时，订阅限额或失效不会静默切到按量计费 API Key，也绝不会在多个 ChatGPT 账号间自动轮换。",
                )
              }}</small>
            </span>
          </label>
        </div>

        <div v-if="chatgptModelsError" class="notice chatgpt-warn" role="alert">
          {{ chatgptModelsError }}
        </div>
        <div
          v-if="chatgptModelsNotice || chatgptModels.length"
          class="chatgpt-live-models"
        >
          <p v-if="chatgptModelsNotice" class="faint">
            {{ chatgptModelsNotice }}
          </p>
          <div v-if="chatgptModels.length" class="live-model-list">
            <div
              v-for="item in chatgptModels"
              :key="item.slug"
              class="live-model-row"
            >
              <div class="live-model-info">
                <b>{{ item.displayName || item.slug }}</b>
                <small>{{ item.slug }}</small>
              </div>
              <button
                type="button"
                class="small"
                @click="createProfileFromLiveModel(item)"
              >
                {{ t("新建此订阅模型") }}
              </button>
            </div>
          </div>
        </div>

        <details class="advanced chatgpt-vm-box">
          <summary>{{ t("自托管服务器（VPS）与使用边界说明") }}</summary>
          <div class="chatgpt-vm-content">
            <p class="faint">
              {{
                t(
                  "官方 OAuth 回调固定为本机 127.0.0.1 临时端口。通过 Tailscale HTTPS 等远程打开管理台时，可直接点击 Continue with ChatGPT 并粘贴回调链接完成认证，也可使用 SSH 端口转发，或按官方自托管 VM 流程在本机登录后通过 SSH 导出迁移凭据导入。",
                )
              }}
            </p>
            <code class="vm-cmd"
              >luckytri chatgpt-auth export-transfer --out transfer.json</code
            >
            <code class="vm-cmd"
              >luckytri chatgpt-auth import-transfer transfer.json</code
            >
            <p v-if="chatgptStatus?.hostId" class="faint host-id-line">
              {{ t("本机 Host ID（迁移不会覆盖）：") }}
              <code>{{ chatgptStatus.hostId }}</code>
            </p>
            <label class="transfer-label">
              <span>{{
                t("或在此粘贴本地导出的迁移凭据 JSON（仅限你本人的受控主机）")
              }}</span>
              <textarea
                v-model="transferInput"
                rows="3"
                :placeholder="
                  t('粘贴 luckytri chatgpt-auth export-transfer 输出的 JSON')
                "
              />
            </label>
            <div class="chatgpt-actions">
              <button
                type="button"
                class="small"
                :disabled="transferBusy || !transferInput.trim()"
                @click="submitTransferImport"
              >
                {{ transferBusy ? t("正在导入…") : t("导入本地迁移凭据") }}
              </button>
            </div>
          </div>
        </details>
      </section>
    </div>
    <Sheet
      :open="editorOpen"
      :title="draft.label || t('模型档案')"
      width="820px"
      @close="closeEditor"
    >
      <section v-if="editing && editorOpen" class="card detail">
        <div class="card-head">
          <div>
            <span class="eyebrow">{{ t("模型档案") }}</span>
            <h2>{{ draft.label || t("新模型") }}</h2>
          </div>
          <span
            class="chip"
            :data-tone="
              isDraftChatGpt
                ? isChatGptProfileReady(draft)
                  ? 'ok'
                  : 'warn'
                : draft.hasApiKey
                  ? 'ok'
                  : 'warn'
            "
            >{{
              (draft.isDefault ? t("默认模型 · ") : "") +
              (isDraftChatGpt
                ? isChatGptProfileReady(draft)
                  ? t("订阅已连接")
                  : t("待连接 ChatGPT 订阅")
                : draft.hasApiKey
                  ? t("密钥已保存")
                  : t("待填写密钥"))
            }}</span
          >
        </div>
        <form
          id="modelForm"
          class="stack"
          @submit.prevent="save"
          @input="studio.dirty = true"
        >
          <fieldset>
            <legend>{{ t("连接") }}</legend>
            <div class="form-grid">
              <label v-if="vendorModels.length > 1">
                {{ t("同厂商模型") }}
                <Select
                  :model-value="draft.presetId"
                  :aria-label="t('同厂商模型')"
                  :options="
                    vendorModels.map((item: any) => ({
                      value: item.id,
                      label: item.label,
                    }))
                  "
                  @change="switchPreset"
                />
              </label>
              <label
                >{{ t("显示名称")
                }}<input v-model="draft.label" name="label" required
              /></label>
              <label
                >{{ t("供应商")
                }}<input
                  v-model="draft.provider"
                  name="provider"
                  :placeholder="t('例如 deepseek、openai')"
              /></label>
              <label
                >{{ t("API 地址")
                }}<input
                  v-model="draft.baseUrl"
                  name="baseUrl"
                  type="url"
                  :readonly="isDraftChatGpt"
                  required
              /></label>
              <label
                >{{ t("模型名称")
                }}<input v-model="draft.model" name="model" required
              /></label>
              <div v-if="isDraftChatGpt" class="wide chatgpt-draft-note">
                <label v-if="chatgptAccounts.length">
                  {{ t("绑定的 ChatGPT 订阅账号") }}
                  <Select
                    v-model="draft.oauthAccountId"
                    :aria-label="t('绑定的 ChatGPT 订阅账号')"
                    :options="[
                      { value: '', label: t('跟随默认订阅账号') },
                      ...chatgptAccounts.map((acc: any) => ({
                        value: acc.accountId,
                        label: `${chatGptAccountLabel(acc)} · ${chatGptStatusLabel(acc)}`,
                      })),
                    ]"
                  />
                </label>
                <p class="faint">
                  {{
                    t(
                      "此模型通过官方 Sign in with ChatGPT 和直连 Responses API（store=false、stream=true）调用，无需填写 OpenAI API Key。",
                    )
                  }}
                  <a
                    :href="chatgptUsageUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="usage-link"
                    >{{ t("管理用量 ↗") }}</a
                  >
                </p>
              </div>
              <label v-else class="wide">
                API Key
                <input
                  v-model="draft.apiKey"
                  name="apiKey"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="
                    draft.hasApiKey
                      ? t('已保存，留空则保留')
                      : t('填写供应商提供的密钥')
                  "
                />
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>{{ t("容量与思考") }}</legend>
            <p class="faint">
              {{
                t(
                  "官方按输入长度分档计价的模型可以在标准和百万之间切换；输出上限默认是官方最大值，思考强度只列出这个模型支持的档位。",
                )
              }}
            </p>
            <div class="form-grid">
              <label v-if="contextOptions.length">
                {{ t("上下文容量") }}
                <Select
                  name="contextWindow"
                  :model-value="draft.contextWindow"
                  :options="
                    contextOptions.map((option: any) => ({
                      value: option.contextWindow,
                      label: option.label,
                    }))
                  "
                  @change="applyContextWindow"
                />
              </label>
              <label v-else
                >{{ t("上下文容量")
                }}<input
                  v-model.number="draft.contextWindow"
                  name="contextWindow"
                  type="number"
              /></label>
              <label
                >{{ t("最大输入 Token")
                }}<input
                  v-model.number="draft.maxInputTokens"
                  name="maxInputTokens"
                  type="number"
              /></label>
              <label
                >{{ t("最大输出 Token")
                }}<input
                  v-model.number="draft.maxOutputTokens"
                  name="maxOutputTokens"
                  type="number"
              /></label>
              <label>
                {{ t("思考强度") }}
                <Select
                  v-model="draft.reasoningEffort"
                  name="reasoningEffort"
                  :aria-label="t('思考强度')"
                  :options="
                    effortOptions.map((v: string) => ({
                      value: v,
                      label: effortName(v),
                    }))
                  "
                />
              </label>
            </div>
          </fieldset>
          <details class="advanced">
            <summary>{{ t("高级参数与模型能力") }}</summary>
            <div class="form-grid">
              <label v-if="!isDraftChatGpt"
                >{{ t("随机程度 Temperature")
                }}<input
                  v-model.number="draft.temperature"
                  name="temperature"
                  type="number"
                  step="0.05"
              /></label>
              <label v-if="!isDraftChatGpt"
                >{{ t("采样范围 Top P")
                }}<input
                  v-model.number="draft.topP"
                  name="topP"
                  type="number"
                  step="0.05"
              /></label>
              <label
                >{{ t("超时（毫秒）")
                }}<input
                  v-model.number="draft.timeoutMs"
                  name="timeoutMs"
                  type="number"
              /></label>
              <label v-if="!isDraftChatGpt"
                >{{ t("知识检索模型")
                }}<input
                  v-model="draft.embeddingModel"
                  name="embeddingModel"
                  :placeholder="t('留空跟随对话模型')"
              /></label>
            </div>
            <p v-if="isDraftChatGpt" class="faint">
              {{
                t(
                  "ChatGPT 订阅预览接口固定使用 store=false、stream=true，不支持采样参数和向量 Embedding；如需知识向量请在「系统 → 知识向量」单独配置 API Key 模型。",
                )
              }}
            </p>
            <p class="faint">
              {{
                t(
                  "打开图片理解后，聊天里的图片会先在本机读取，再连同画面交给这个模型。主模型不能看图时，到会话设置另选一个打开了图片理解的视觉兼容模型。",
                )
              }}
            </p>
            <div class="caps">
              <label
                v-for="(label, key) in {
                  vision: t('图片理解'),
                  system: 'System Prompt',
                  json: t('JSON 输出'),
                  tools: t('工具调用'),
                  embedding: t('知识向量'),
                }"
                :key="key"
                class="check"
              >
                <input
                  v-model="draft[key]"
                  :name="key"
                  type="checkbox"
                  :disabled="isDraftChatGpt && key === 'embedding'"
                />{{ label }}
              </label>
            </div>
          </details>
          <div
            v-if="testResult"
            id="modelTestResult"
            class="notice"
            role="status"
          >
            {{ testResult }}
          </div>
          <div class="actions">
            <button class="primary" :disabled="busy">
              {{ busy ? t("正在保存…") : t("保存模型") }}
            </button>
            <small class="faint">{{
              studio.dirty
                ? t("有未保存的修改")
                : t("已保存的模型才会用来测试和回复")
            }}</small>
            <label v-if="!draft.isDefault" class="check">
              <input
                type="checkbox"
                :checked="draft.enabled !== false"
                @change="
                  draft.enabled = ($event.target as HTMLInputElement).checked;
                  studio.dirty = true;
                "
              />{{ t("启用这个备用模型") }}
            </label>
            <button
              v-if="!draft.isDefault"
              id="setDefaultModel"
              type="button"
              @click="makeDefault"
            >
              {{ t("设为默认模型") }}
            </button>
            <button
              v-if="hasSavedProfile"
              id="testModel"
              type="button"
              :disabled="busy || testing || studio.dirty"
              @click="testModel"
            >
              {{
                testing
                  ? t("正在测试…")
                  : studio.dirty
                    ? t("保存后测试此模型")
                    : t("测试此模型连接")
              }}
            </button>
            <button
              id="deleteModel"
              type="button"
              class="danger push"
              @click="remove"
            >
              {{ t("删除模型") }}
            </button>
          </div>
        </form>
      </section>
    </Sheet>
    <section class="card usage-panel" aria-labelledby="token-usage-title">
      <div class="usage-intro">
        <div>
          <h2 id="token-usage-title">{{ t("累计用量") }}</h2>
          <p>
            {{ t("统计本机账本记录的模型调用；缓存 Token 已包含在输入量里。") }}
          </p>
        </div>
        <div class="usage-total">
          <strong>{{ formatCount(tokenUsage?.total) }}</strong>
          <span>{{ t("累计 Token") }}</span>
        </div>
      </div>
      <div class="usage-detail">
        <div class="usage-stat">
          <span>{{ t("输入") }}</span>
          <b>{{ formatCount(tokenUsage?.input) }}</b>
        </div>
        <div class="usage-stat">
          <span>{{ t("输出") }}</span>
          <b>{{ formatCount(tokenUsage?.output) }}</b>
        </div>
        <div class="usage-stat cache-stat">
          <span
            >{{ t("缓存命中") }} <small>{{ t("（输入子项）") }}</small></span
          >
          <b>{{ formatCount(tokenUsage?.cached) }}</b>
        </div>
        <div class="usage-stat">
          <span>{{ t("调用次数") }}</span>
          <b>{{ formatCount(tokenUsage?.calls) }}</b>
        </div>
      </div>
      <div class="usage-foot">
        <small v-if="tokenUsage?.since">
          {{
            t("从 {v} 开始记录 · {v2} 为模型返回用量", {
              v: new Date(tokenUsage.since).toLocaleDateString(intlLocale()),
              v2: formatCount(tokenUsage.reportedTokens),
            })
          }}
          <template v-if="tokenUsage.estimatedCalls">
            {{
              t("· {v} 次调用按文本估算", {
                v: formatCount(tokenUsage.estimatedCalls),
              })
            }}
          </template>
        </small>
        <small v-else-if="usageError" class="usage-error">{{
          usageError
        }}</small>
        <small v-else>{{ t("还没有模型调用记录。") }}</small>
        <button
          type="button"
          class="usage-refresh"
          :disabled="usageBusy"
          @click="loadUsage"
        >
          {{ usageBusy ? t("更新中…") : t("刷新统计 ↻") }}
        </button>
      </div>
    </section>

    <Sheet
      :open="picker"
      :title="t('选择模型')"
      eyebrow="MODELS"
      width="880px"
      @close="picker = false"
    >
      <div class="model-picker">
        <p class="muted">
          {{
            t(
              "先选供应商，再挑具体模型；支持搜索。火山方舟 Coding Plan 已预填套餐专用接口与型号参数，请勿换成普通推理 API 地址。",
            )
          }}
        </p>
        <label class="catalog-search">
          <span>{{ t("搜索模型或供应商") }}</span>
          <input
            v-model="catalogSearch"
            type="search"
            :placeholder="t('例如：火山方舟、Kimi K3、DeepSeek')"
          />
        </label>
        <details
          v-for="group in filteredGroups"
          :key="group.vendor"
          class="vendor"
          :data-vendor="group.vendor"
        >
          <summary class="vendor-summary">
            <span class="vendor-name">
              <b>{{ group.vendor }}</b>
              <small>{{
                t("{length} 个预设", { length: group.models.length })
              }}</small>
            </span>
            <span class="vendor-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="presets">
            <button
              v-for="item in group.models"
              :key="item.id"
              type="button"
              class="preset-card"
              :data-preset="item.id"
              @click="choosePreset(item)"
            >
              <b>{{ item.label }}</b>
              <small>{{
                item.model || t("填写你在 OpenRouter 选择的模型 ID")
              }}</small>
              <small>{{ capacity(item) }}</small>
              <small>{{ item.summary }}</small>
            </button>
          </div>
        </details>
        <p v-if="!filteredGroups.length" class="muted search-empty">
          {{ t("没有找到匹配的模型预设。") }}
        </p>
        <button
          v-if="customPreset"
          type="button"
          class="preset-card custom"
          data-preset="custom"
          @click="choosePreset(customPreset)"
        >
          <b>{{ customPreset.label }}</b>
          <small>{{ customPreset.summary }}</small>
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@layer components {
  .library {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gap);
  }
  .model-workspace {
    display: grid;
    grid-template-columns: minmax(260px, 0.32fr) minmax(0, 1fr);
    gap: var(--gap);
    align-items: start;
  }
  .shelf {
    position: sticky;
    top: 14px;
    display: grid;
    gap: 15px;
    background:
      radial-gradient(
        ellipse at 0 0,
        color-mix(in srgb, var(--glow-a) 23%, transparent),
        transparent 56%
      ),
      var(--surface);
  }
  .chatgpt-sub-panel {
    display: grid;
    gap: 14px;
    min-width: 0;
    background:
      radial-gradient(
        ellipse at 100% 0,
        color-mix(in srgb, var(--glow-b) 22%, transparent),
        transparent 54%
      ),
      var(--surface);
  }
  .chatgpt-banner,
  .chatgpt-warn,
  .chatgpt-pending {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .chatgpt-warn {
    border-color: color-mix(in srgb, var(--warn, #d97706) 35%, white);
  }
  .chatgpt-account-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid rgb(255 255 255 / 0.78);
    border-radius: 16px;
    background: rgb(255 255 255 / 0.38);
    min-width: 0;
  }
  .chatgpt-account-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .plan-pill {
    padding: 3px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-soft) 75%, white);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
  }
  .usage-link {
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .usage-link:hover {
    text-decoration: underline;
  }
  .chatgpt-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .chatgpt-policies {
    display: grid;
    gap: 10px;
  }
  .policy-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgb(255 255 255 / 0.72);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.28);
  }
  .policy-check span {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .policy-check b {
    font-size: 13px;
  }
  .chatgpt-live-models {
    display: grid;
    gap: 8px;
  }
  .live-model-list {
    display: grid;
    gap: 6px;
    max-height: 240px;
    overflow: auto;
  }
  .live-model-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
    border: 1px solid rgb(255 255 255 / 0.78);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.42);
  }
  .live-model-info {
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .live-model-info small {
    color: var(--ink-soft);
    font-size: 11px;
  }
  .chatgpt-vm-content {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .vm-cmd {
    display: block;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgb(255 255 255 / 0.55);
    font-size: 11.5px;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .host-id-line {
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .transfer-label {
    display: grid;
    gap: 6px;
    font-size: 12px;
  }
  .transfer-label textarea,
  .transfer-label input {
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid rgb(255 255 255 / 0.85);
    border-radius: 12px;
    background: rgb(255 255 255 / 0.6);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
  }
  .transfer-label textarea {
    resize: vertical;
  }
  .chatgpt-remote-tip {
    display: grid;
    gap: 4px;
    border-color: color-mix(in srgb, var(--accent) 26%, white);
    background: color-mix(in srgb, var(--accent) 6%, rgb(255 255 255 / 0.6));
  }
  .chatgpt-remote-steps {
    margin: 4px 0 6px;
    padding-left: 18px;
    display: grid;
    gap: 4px;
    font-size: 12px;
    line-height: 1.55;
  }
  .chatgpt-callback-form {
    display: grid;
    gap: 8px;
    margin-top: 6px;
  }
  .callback-hint {
    font-size: 11.5px;
    line-height: 1.45;
  }
  .callback-hint.ok {
    color: #116329;
  }
  .callback-hint.warn {
    color: #9a5b13;
  }
  .callback-hint.err {
    color: var(--danger);
  }
  .chatgpt-ssh-box {
    margin-top: 6px;
    padding: 8px 10px;
    border: 1px dashed rgb(0 0 0 / 0.12);
    border-radius: 12px;
    background: rgb(255 255 255 / 0.4);
    display: grid;
    gap: 8px;
  }
  .chatgpt-ssh-box summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .chatgpt-draft-note {
    display: grid;
    gap: 8px;
  }
  .detail {
    background:
      radial-gradient(
        ellipse at 100% 0,
        color-mix(in srgb, var(--glow-b) 16%, transparent),
        transparent 47%
      ),
      var(--surface);
  }
  .usage-panel {
    grid-column: 1 / -1;
    display: grid;
    gap: 18px;
    overflow: hidden;
    background:
      radial-gradient(
        ellipse at 100% 0,
        color-mix(in srgb, var(--glow-a) 25%, transparent),
        transparent 42%
      ),
      radial-gradient(
        ellipse at 0 100%,
        color-mix(in srgb, var(--glow-b) 20%, transparent),
        transparent 46%
      ),
      var(--surface);
  }
  .usage-intro {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 20px;
  }
  .usage-intro h2 {
    margin: 5px 0 4px;
    font-size: 22px;
    letter-spacing: -0.04em;
  }
  .usage-intro p,
  .usage-foot small {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .usage-total {
    display: grid;
    justify-items: end;
    flex: none;
  }
  .usage-total strong {
    color: var(--accent);
    font: 700 clamp(28px, 4vw, 42px) var(--font-display);
    letter-spacing: -0.055em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .usage-total span {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .usage-detail {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .usage-stat {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid rgb(255 255 255 / 0.78);
    border-radius: 18px;
    background: rgb(255 255 255 / 0.36);
    box-shadow: inset 0 1px 0 white;
  }
  .usage-stat span {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .usage-stat span small {
    font-size: 10px;
  }
  .usage-stat b {
    overflow: hidden;
    font-size: 19px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
  }
  .usage-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .usage-error {
    color: var(--danger) !important;
  }
  .usage-refresh {
    color: var(--accent);
    font-size: 12px;
  }
  .shelf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .shelf-head h2 {
    font-size: 21px;
    letter-spacing: -0.04em;
  }
  .shelf-head small {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .rows {
    display: grid;
    gap: 8px;
    max-height: 520px;
    overflow: auto;
  }
  .saved-vendor {
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.68);
    border-radius: 17px;
    background: rgb(255 255 255 / 0.2);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.72);
  }
  .saved-vendor > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 11px 13px;
    color: var(--ink);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    list-style: none;
  }
  .saved-vendor > summary::-webkit-details-marker,
  .vendor-summary::-webkit-details-marker {
    display: none;
  }
  .saved-vendor > summary::after {
    color: var(--accent);
    content: "⌄";
    font-size: 15px;
    transition: transform 0.24s var(--spring);
  }
  .saved-vendor[open] > summary {
    border-bottom: 1px solid rgb(255 255 255 / 0.6);
    background: rgb(255 255 255 / 0.25);
  }
  .saved-vendor[open] > summary::after {
    transform: rotate(180deg);
  }
  .saved-vendor > summary small {
    margin-left: auto;
    color: var(--ink-soft);
    font-size: 10px;
    font-weight: 500;
  }
  .vendor-models {
    display: grid;
    gap: 6px;
    padding: 7px;
  }
  .entity-row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    border: 1px solid rgb(255 255 255 / 0.75);
    border-radius: 18px;
    background: rgb(255 255 255 / 0.36);
    box-shadow: inset 0 1px 0 white;
    text-align: left;
    backdrop-filter: blur(16px) saturate(1.5);
    transition:
      transform 0.32s var(--spring),
      background-color 0.2s,
      box-shadow 0.25s;
  }
  .entity-row:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.66);
    transform: translateX(4px) scale(1.01);
    box-shadow: 0 12px 22px -19px var(--accent);
  }
  .entity-row.selected {
    border-color: color-mix(in srgb, var(--accent) 22%, white);
    background: linear-gradient(
      115deg,
      white,
      color-mix(in srgb, var(--accent-soft) 60%, white)
    );
    box-shadow:
      inset 0 1px 0 white,
      0 13px 23px -20px var(--accent);
  }
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 14px;
    background: linear-gradient(145deg, white, hsl(var(--hue) 70% 88%));
    color: hsl(var(--hue) 45% 25%);
    font-weight: 700;
    box-shadow:
      inset 0 1px 0 white,
      0 5px 13px -10px hsl(var(--hue) 45% 32%);
  }
  .who {
    display: grid;
    min-width: 0;
    line-height: 1.35;
  }
  .who b {
    overflow: hidden;
    font-size: 13.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who small {
    color: var(--ink-soft);
    font-size: 11.5px;
    font-weight: 500;
  }
  fieldset {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: var(--surface);
    box-shadow: none;
  }
  legend {
    padding: 0 8px;
    font-weight: 700;
    font-size: 13px;
  }
  .advanced summary {
    padding: 12px 15px;
    border: 1px solid rgb(255 255 255 / 0.8);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.42);
    box-shadow: inset 0 1px 0 white;
    color: var(--accent);
    font-weight: 600;
    transition:
      transform 0.3s var(--spring),
      background-color 0.2s;
  }
  .advanced summary:hover {
    transform: translateX(3px);
    background: rgb(255 255 255 / 0.65);
  }
  .advanced[open] summary {
    margin-bottom: 12px;
  }
  .caps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin-top: 10px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions .push {
    margin-left: auto;
  }
  .model-picker {
    display: grid;
    gap: 16px;
  }
  .catalog-search {
    display: grid;
    gap: 6px;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 600;
  }
  .catalog-search input {
    width: 100%;
    min-height: 42px;
    padding: 0 13px;
    border: 1px solid rgb(255 255 255 / 0.85);
    border-radius: 14px;
    outline: none;
    background: rgb(255 255 255 / 0.62);
    color: var(--ink);
    box-shadow: inset 0 1px 0 white;
    backdrop-filter: blur(14px) saturate(1.4);
  }
  .catalog-search input:focus {
    border-color: color-mix(in srgb, var(--accent) 42%, white);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .vendor {
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.72);
    border-radius: 21px;
    background:
      radial-gradient(
        ellipse at 100% 0,
        color-mix(in srgb, var(--glow-a) 13%, transparent),
        transparent 48%
      ),
      rgb(255 255 255 / 0.23);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.78);
    backdrop-filter: blur(18px) saturate(1.35);
  }
  .vendor-summary {
    display: flex;
    min-height: 62px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 17px;
    cursor: pointer;
    list-style: none;
    transition: background-color 0.2s;
  }
  .vendor-summary:hover {
    background: rgb(255 255 255 / 0.34);
  }
  .vendor-name {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }
  .vendor-name b {
    font-size: 13px;
  }
  .vendor-name small {
    color: var(--ink-soft);
    font-size: 10px;
  }
  .vendor-chevron {
    color: var(--accent);
    font-size: 20px;
    line-height: 1;
    transition: transform 0.28s var(--spring);
  }
  .vendor[open] .vendor-chevron {
    transform: rotate(180deg);
  }
  .vendor[open] .presets {
    animation: vendor-reveal 0.24s var(--spring) both;
  }
  @keyframes vendor-reveal {
    from {
      opacity: 0;
      transform: translateY(-5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .search-empty {
    margin: 0;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
    padding: 0 12px 12px;
  }
  .preset-card {
    display: grid;
    justify-items: start;
    gap: 3px;
    padding: 17px;
    border: 1px solid rgb(255 255 255 / 0.82);
    border-radius: 21px;
    background:
      radial-gradient(
        ellipse at 100% 0,
        color-mix(in srgb, var(--glow-a) 22%, transparent),
        transparent 55%
      ),
      rgb(255 255 255 / 0.5);
    box-shadow:
      inset 0 1px 0 white,
      0 12px 22px -20px var(--accent);
    text-align: left;
    font-weight: 500;
    backdrop-filter: blur(16px) saturate(1.5);
    transition:
      transform 0.42s var(--spring),
      box-shadow 0.25s;
  }
  .preset-card:hover:not(:disabled) {
    transform: translateY(-6px) rotate(-0.5deg) scale(1.025);
    box-shadow:
      inset 0 1px 0 white,
      0 22px 33px -22px var(--accent);
  }
  .preset-card small {
    color: var(--ink-soft);
    font-size: 11.5px;
  }
  @media (max-width: 900px) {
    .model-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
    .usage-panel {
      grid-column: auto;
    }
    .shelf {
      position: static;
    }
  }
  @media (max-width: 620px) {
    .usage-intro {
      align-items: start;
      flex-direction: column;
    }
    .usage-total {
      justify-items: start;
    }
    .usage-detail {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}
</style>
