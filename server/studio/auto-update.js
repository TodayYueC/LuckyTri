// Automatic updates: off unless the owner turns them on. At the chosen time
// it checks the registry; with "install" it waits for a safe moment (no
// backup, cleanup, transfer or update running, and she is not in the middle
// of a conversation) and then runs the same verified update as the button:
// backup checked, migrate, restart, health check, roll back on failure.
import { compareVersions } from "./updates.js";

export const AUTO_UPDATE_DEFAULTS = {
  enabled: false,
  mode: "daily", // daily | interval
  at: "04:00", // daily, in the owner's time zone
  everyHours: 24, // interval
  install: "notify", // notify | auto
  window: "", // optional "02:00-06:00"
};
const QUIET_MS = 10 * 60000;
const DEFER_MAX_MS = 24 * 3600000;

function minutes(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function localMinutes(now, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone || "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get("hour") * 60 + get("minute");
}
function localDay(now, zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone || "Asia/Shanghai",
  }).format(new Date(now));
}
export function inWindow(window, now, zone) {
  const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(window || ""));
  if (!m) return true;
  const [from, to] = [minutes(m[1]), minutes(m[2])];
  if (from == null || to == null) return true;
  const at = localMinutes(now, zone);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

export function normalizeAutoUpdate(value = {}) {
  const v = { ...AUTO_UPDATE_DEFAULTS, ...(value || {}) };
  return {
    enabled: v.enabled === true,
    mode: v.mode === "interval" ? "interval" : "daily",
    at: minutes(v.at) == null ? AUTO_UPDATE_DEFAULTS.at : v.at,
    everyHours: [6, 12, 24, 72].includes(Number(v.everyHours))
      ? Number(v.everyHours)
      : 24,
    install: v.install === "auto" ? "auto" : "notify",
    window: /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(String(v.window || ""))
      ? v.window
      : "",
  };
}

export class AutoUpdater {
  constructor({
    repo,
    checker,
    updater,
    occupied = () => false,
    talking = () => false,
    zone = () => "Asia/Shanghai",
    now = Date.now,
  }) {
    Object.assign(this, {
      repo,
      checker,
      updater,
      occupied,
      talking,
      zone,
      now,
    });
    this.waiting = null; // { version, since, reason }
  }
  settings() {
    return normalizeAutoUpdate(this.repo.config("autoUpdate"));
  }
  save(value) {
    const next = normalizeAutoUpdate(value);
    this.repo.saveConfig("autoUpdate", next);
    return next;
  }
  state() {
    return this.repo.config("autoUpdateState", {
      lastCheckDay: "",
      lastCheckAt: 0,
      failedVersions: [],
      history: [],
    });
  }
  note(entry) {
    const s = this.state();
    s.history = [{ time: this.now(), ...entry }, ...(s.history || [])].slice(
      0,
      20,
    );
    this.repo.saveConfig("autoUpdateState", s);
  }
  due(settings, state, now) {
    const zone = this.zone();
    if (settings.mode === "interval")
      return now - (state.lastCheckAt || 0) >= settings.everyHours * 3600000;
    return (
      state.lastCheckDay !== localDay(now, zone) &&
      localMinutes(now, zone) >= minutes(settings.at)
    );
  }
  view() {
    const s = this.state();
    return {
      settings: this.settings(),
      waiting: this.waiting,
      lastCheckAt: s.lastCheckAt || null,
      history: s.history || [],
    };
  }
  // Called from the one-minute maintenance loop.
  async tick() {
    const settings = this.settings();
    if (!settings.enabled) {
      this.waiting = null;
      return "off";
    }
    const now = this.now();
    if (this.waiting) return this.tryInstall(settings, now);
    const state = this.state();
    if (!this.due(settings, state, now)) return "idle";
    state.lastCheckAt = now;
    state.lastCheckDay = localDay(now, this.zone());
    this.repo.saveConfig("autoUpdateState", state);
    const info = await this.checker.check();
    if (info.status !== "available") {
      this.note({
        result: info.error ? "check-failed" : "current",
        to: info.latest || "",
      });
      return "checked";
    }
    if (settings.install !== "auto" || info.installation !== "npm") {
      this.note({ result: "available", from: info.current, to: info.latest });
      return "notified";
    }
    if ((state.failedVersions || []).includes(info.latest)) {
      this.note({
        result: "skipped",
        to: info.latest,
        reason: "这个版本上次自动更新失败过，不再自动重试",
      });
      return "skipped";
    }
    this.waiting = {
      version: info.latest,
      from: info.current,
      since: now,
      reason: "",
    };
    return this.tryInstall(settings, now);
  }
  async tryInstall(settings, now) {
    const w = this.waiting;
    if (now - w.since > DEFER_MAX_MS) {
      this.note({ result: "deferred", to: w.version, reason: w.reason });
      this.waiting = null;
      return "deferred";
    }
    const block =
      this.occupied() || this.updater?.busy
        ? "备份、整理、迁移或更新正在进行"
        : this.talking(QUIET_MS)
          ? "她正在聊天，稍后再试"
          : !inWindow(settings.window, now, this.zone())
            ? "不在允许的更新时段"
            : "";
    if (block) {
      w.reason = block;
      return "waiting";
    }
    this.waiting = null;
    try {
      await this.updater.install(w.version);
      this.note({ result: "started", from: w.from, to: w.version });
      return "installing";
    } catch (error) {
      const s = this.state();
      s.failedVersions = [
        ...new Set([...(s.failedVersions || []), w.version]),
      ].slice(-10);
      this.repo.saveConfig("autoUpdateState", s);
      this.note({ result: "failed", to: w.version, reason: error.message });
      return "failed";
    }
  }
  // After a restart: an update that rolled back marks its version so it is
  // not tried again automatically.
  observe(status) {
    if (
      !status?.version ||
      !/restored|recovery|error|failed/i.test(String(status.status || ""))
    )
      return;
    const s = this.state();
    if ((s.failedVersions || []).includes(status.version)) return;
    s.failedVersions = [...(s.failedVersions || []), status.version].slice(-10);
    this.repo.saveConfig("autoUpdateState", s);
    this.note({ result: "rolled-back", to: status.version });
  }
}

export function newer(a, b) {
  try {
    return compareVersions(a, b) > 0;
  } catch {
    return false;
  }
}
