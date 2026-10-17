// How OneBot delivers a NetEase music card. Some OneBot clients need a
// musicSignUrl in its own WebUI; we keep a mirror hint and delivery policy here.
export const MUSIC_DEFAULTS = {
  musicSignUrl: "",
  preferCard: true,
  allowLinkFallback: true,
  failClosed: false,
};

const MUSIC_EVENT_MAX_AGE = 24 * 60 * 60_000;
const MUSIC_EVENT_FUTURE_SKEW = 5 * 60_000;

function sanitizeMusicEvent(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const at = Number(value.at);
  if (
    !Number.isFinite(at) ||
    at <= 0 ||
    at > now + MUSIC_EVENT_FUTURE_SKEW ||
    now - at > MUSIC_EVENT_MAX_AGE
  )
    return null;
  const status = ["sent", "failed"].includes(value.status)
    ? value.status
    : null;
  if (!status) return null;
  return {
    at,
    status,
    degraded: value.degraded === "link" ? "link" : null,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 500) : "",
    hint: typeof value.hint === "string" ? value.hint.slice(0, 500) : "",
    signatureIssue: value.signatureIssue === true,
    sessionId:
      typeof value.sessionId === "string" ? value.sessionId.slice(0, 120) : "",
    query: typeof value.query === "string" ? value.query.slice(0, 200) : "",
    songId:
      typeof value.songId === "string" || typeof value.songId === "number"
        ? String(value.songId).slice(0, 100)
        : "",
  };
}

function dbOf(storeOrRepo) {
  return (
    storeOrRepo?.db || storeOrRepo?.store?.db || storeOrRepo?.repo?.db || null
  );
}

function readConfig(storeOrRepo, id, fallback = null) {
  if (typeof storeOrRepo?.config === "function")
    return storeOrRepo.config(id, fallback);
  if (typeof storeOrRepo?.repo?.config === "function")
    return storeOrRepo.repo.config(id, fallback);
  const db = dbOf(storeOrRepo);
  if (!db) return fallback;
  try {
    const row = db.prepare("SELECT value FROM core_config WHERE id=?").get(id);
    return row ? JSON.parse(row.value) : fallback;
  } catch {
    return fallback;
  }
}

function writeConfig(storeOrRepo, id, value) {
  if (typeof storeOrRepo?.saveConfig === "function")
    return storeOrRepo.saveConfig(id, value);
  if (typeof storeOrRepo?.repo?.saveConfig === "function")
    return storeOrRepo.repo.saveConfig(id, value);
  const db = dbOf(storeOrRepo);
  if (!db) throw Error("无法保存音乐卡片设置");
  db.prepare(
    "INSERT INTO core_config(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=version+1",
  ).run(id, JSON.stringify(value));
}

export function musicSettings(storeOrRepo) {
  const raw = readConfig(storeOrRepo, "onebot-music", {}) || {};
  return { ...MUSIC_DEFAULTS, ...raw };
}

export function musicLastEvent(storeOrRepo, now = Date.now()) {
  return sanitizeMusicEvent(
    readConfig(storeOrRepo, "onebot-music-last", null),
    now,
  );
}

export function saveMusicSettings(storeOrRepo, input = {}) {
  const next = { ...musicSettings(storeOrRepo), ...input };
  if (typeof next.musicSignUrl === "string")
    next.musicSignUrl = next.musicSignUrl.trim().slice(0, 500);
  for (const key of ["preferCard", "allowLinkFallback", "failClosed"])
    if (typeof next[key] !== "boolean") throw Error(`${key} 须为布尔值`);
  if (next.failClosed) next.allowLinkFallback = false;
  writeConfig(storeOrRepo, "onebot-music", {
    musicSignUrl: next.musicSignUrl,
    preferCard: next.preferCard,
    allowLinkFallback: next.allowLinkFallback,
    failClosed: next.failClosed,
  });
  return musicSettings(storeOrRepo);
}

export function musicLinkText(song) {
  return `${song.name} - ${song.artist} https://music.163.com/song?id=${song.id}`;
}

export function musicCardHint(settings = MUSIC_DEFAULTS) {
  const steps =
    "步骤：① 在接入端 WebUI 配置音乐签名服务；② 本页可填写 musicSignUrl 作为镜像提示；③ 优先发卡片，失败时可降级为链接或 failClosed 只卡片。";
  if (settings.musicSignUrl)
    return `已填写 musicSignUrl 提示；仍失败时请核对接入端 WebUI 的音乐签名服务是否可用。${steps}`;
  return `卡片失败常见原因：接入端未配置音乐签名（musicSignUrl）。${steps}`;
}

export function musicReadyState(settings = MUSIC_DEFAULTS, lastEvent = null) {
  if (lastEvent?.signatureIssue)
    return {
      ready: "degraded_link",
      label: "最近卡片错误可能与签名有关，已降级为链接；请检查接入端音乐签名",
    };
  if (lastEvent?.status === "failed")
    return {
      ready: "error",
      label: "最近一次音乐发送失败；请稍后重试或查看接入端日志",
    };
  if (lastEvent?.degraded === "link")
    return { ready: "degraded_link", label: "最近一次已降级为纯链接" };
  if (!settings.musicSignUrl)
    return {
      ready: "needs_sign",
      label: "尚未填写 musicSignUrl 提示；接入端也需配置签名",
    };
  return { ready: "ok", label: "已填写签名提示；以接入端实际签名服务为准" };
}

// Skip card RPCs only after an explicit or strongly indicated signing failure.
export function shouldSkipCard(
  settings = MUSIC_DEFAULTS,
  lastEvent = null,
  now = Date.now(),
) {
  if (settings.musicSignUrl) return false;
  if (!lastEvent) return false;
  const at = Number(lastEvent.at || 0);
  if (!at || now - at > 24 * 3600_000) return false;
  return (
    lastEvent.signatureIssue === true &&
    (lastEvent.degraded === "link" || lastEvent.status === "failed")
  );
}

function isLikelySignatureFailure(reason) {
  return /签名|未签名|musicSignUrl|消息体无法解析|音乐卡片.*未配置/i.test(
    reason,
  );
}

async function sendLinkFallback({
  link,
  sendText,
  record,
  reason,
  hint,
  signatureIssue = false,
  failPrefix = "音乐链接发送失败",
}) {
  try {
    const result = await sendText(link);
    record({
      status: "sent",
      degraded: "link",
      reason,
      hint,
      signatureIssue,
    });
    return { ...result, degraded: "link" };
  } catch (error) {
    const linkReason = String(error?.message || error).slice(0, 500);
    const combinedReason = `${reason || ""}${reason ? "；" : ""}${failPrefix}：${linkReason}`;
    record({
      status: "failed",
      degraded: null,
      reason: combinedReason,
      hint,
      signatureIssue,
    });
    const wrapped = Error(`${failPrefix}：${linkReason}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

// Card first; optional link fallback. Failures are always recorded — never silent.
export async function deliverMusicCard({
  song,
  settings = MUSIC_DEFAULTS,
  sendCard,
  sendText,
  record = () => {},
  lastEvent = null,
  now = Date.now(),
}) {
  const link = musicLinkText(song);
  const hint = musicCardHint(settings);
  if (settings.preferCard && shouldSkipCard(settings, lastEvent, now)) {
    if (!settings.allowLinkFallback || settings.failClosed) {
      const err = Error("音乐卡片已知未签名且不允许降级为链接");
      record({
        status: "failed",
        degraded: null,
        reason: "skip_card_known_unsigned",
        hint,
        signatureIssue: true,
      });
      throw err;
    }
    return sendLinkFallback({
      link,
      sendText,
      record,
      reason: "skip_card_known_unsigned",
      hint,
      signatureIssue: true,
    });
  }
  if (!settings.preferCard) {
    if (!settings.allowLinkFallback || settings.failClosed) {
      const err = Error("音乐卡片策略不允许发链接，且未启用卡片");
      record({ status: "failed", degraded: null, reason: err.message, hint });
      throw err;
    }
    return sendLinkFallback({
      link,
      sendText,
      record,
      reason: "preferCard=false",
      hint,
    });
  }
  try {
    const result = await sendCard(song);
    record({
      status: "sent",
      degraded: null,
      reason: "",
      hint: "",
      signatureIssue: false,
    });
    return { ...result, degraded: null };
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 500);
    const signatureIssue = isLikelySignatureFailure(reason);
    if (settings.failClosed || !settings.allowLinkFallback) {
      record({
        status: "failed",
        degraded: null,
        reason,
        hint,
        signatureIssue,
      });
      const wrapped = Error(`音乐卡片发送失败：${reason}。${hint}`);
      wrapped.cause = error;
      throw wrapped;
    }
    return sendLinkFallback({
      link,
      sendText,
      record,
      reason,
      hint,
      signatureIssue,
      failPrefix: "音乐卡片与链接发送均失败",
    });
  }
}
