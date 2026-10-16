// How OneBot delivers a NetEase music card. Some OneBot clients need a
// musicSignUrl in its own WebUI; we keep a mirror hint and delivery policy here.
export const MUSIC_DEFAULTS = {
  musicSignUrl: "",
  preferCard: true,
  allowLinkFallback: true,
  failClosed: false,
};

function dbOf(storeOrRepo) {
  return (
    storeOrRepo?.db ||
    storeOrRepo?.store?.db ||
    storeOrRepo?.repo?.db ||
    null
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
  if (lastEvent?.degraded === "link")
    return {
      ready: "degraded_link",
      label: "最近一次已降级为纯链接，请检查音乐签名",
    };
  if (lastEvent?.status === "failed")
    return {
      ready: "needs_sign",
      label: "最近一次卡片发送失败，请配置或核对 musicSignUrl",
    };
  if (!settings.musicSignUrl)
    return {
      ready: "needs_sign",
      label: "尚未填写 musicSignUrl 提示；接入端也需配置签名",
    };
  return { ready: "ok", label: "已填写签名提示；以接入端实际签名服务为准" };
}

// Recent card failure / link degrade with no sign hint → skip another doomed card RPC.
export function shouldSkipCard(settings = MUSIC_DEFAULTS, lastEvent = null, now = Date.now()) {
  if (settings.musicSignUrl) return false;
  if (!lastEvent) return false;
  const at = Number(lastEvent.at || 0);
  if (!at || now - at > 24 * 3600_000) return false;
  return (
    lastEvent.degraded === "link" ||
    lastEvent.status === "failed" ||
    lastEvent.reason === "skip_card_known_unsigned"
  );
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
      });
      throw err;
    }
    const result = await sendText(link);
    record({
      status: "sent",
      degraded: "link",
      reason: "skip_card_known_unsigned",
      hint,
    });
    return { ...result, degraded: "link" };
  }
  if (!settings.preferCard) {
    if (!settings.allowLinkFallback || settings.failClosed) {
      const err = Error("音乐卡片策略不允许发链接，且未启用卡片");
      record({ status: "failed", degraded: null, reason: err.message, hint });
      throw err;
    }
    const result = await sendText(link);
    record({
      status: "sent",
      degraded: "link",
      reason: "preferCard=false",
      hint,
    });
    return { ...result, degraded: "link" };
  }
  try {
    const result = await sendCard(song);
    record({ status: "sent", degraded: null, reason: "", hint: "" });
    return { ...result, degraded: null };
  } catch (error) {
    const reason = String(error?.message || error);
    if (settings.failClosed || !settings.allowLinkFallback) {
      record({ status: "failed", degraded: null, reason, hint });
      const wrapped = Error(`音乐卡片发送失败：${reason}。${hint}`);
      wrapped.cause = error;
      throw wrapped;
    }
    const result = await sendText(link);
    record({
      status: "sent",
      degraded: "link",
      reason,
      hint,
    });
    return { ...result, degraded: "link" };
  }
}
