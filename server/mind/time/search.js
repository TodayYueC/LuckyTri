import { createHash, randomUUID } from "node:crypto";
import { dayKey, hasCredential, text } from "../util.js";
import { describeNetworkError, sanitizeDetail } from "../../core/network.js";
import { modelMaterial, MODEL_MATERIAL_LABEL } from "./model-material.js";
export const SEARCH_DEFAULTS = {
  enabled: true,
  provider: "tavily",
  baseUrl: "https://api.tavily.com/search",
  apiKey: "",
  timeoutMs: 20000,
  maxResults: 5,
  dailyLimit: 12,
};
const ENDPOINTS = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
};
export const SEARCH_TEST_TOPIC = "ATRI 游戏 资料简介";
export class Search {
  constructor(time) {
    this.time = time;
    this.db = time.db;
    this.fetch = (...args) => fetch(...args);
    this.testing = false;
    this.db
      .prepare(
        "UPDATE mind_time_searches SET state='error',error='实例中断，查询结果未确认' WHERE state='running'",
      )
      .run();
  }
  bind(life) {
    this.life = life;
    this.wake();
  }
  mode(profile = this.profile()) {
    return profile.enabled && profile.apiKey ? "web" : "model";
  }
  wake() {
    const now = this.time.now();
    if (this.ready(now)) return;
    for (const row of this.db
      .prepare(
        "SELECT id,ready_at FROM mind_time_tasks WHERE activity='game' AND state='waiting' AND wait_reason IN ('等待独立搜索密钥','独立搜索尚未启用','今日资料查询次数已用完') AND json_extract(checkpoint,'$.mergedInto') IS NULL",
      )
      .all())
      this.time.tasks.control(
        row.id,
        {
          action: "resume",
          readyAt: Math.max(now, row.ready_at),
          reason: "资料查询条件已恢复，重新按优先级安排",
        },
        now,
      );
  }
  profile(provider) {
    const saved = this.time.mind.repo.config("search-profile", {});
    const chosen = provider || saved.provider || "tavily";
    const profile = {
      ...SEARCH_DEFAULTS,
      baseUrl: ENDPOINTS[chosen],
      ...saved.profiles?.[chosen],
      provider: chosen,
    };
    // Existing keys may have been pasted with padding before save normalized it.
    // Activity reads and connection tests must use the same credential bytes.
    return { ...profile, apiKey: profile.apiKey.trim() };
  }
  public(provider, testedProfile) {
    const { apiKey, ...profile } = testedProfile || this.profile(provider);
    const usage = this.usage(this.time.now());
    return {
      ...profile,
      hasApiKey: !!apiKey,
      mode: this.mode({ ...profile, apiKey }),
      materialLabel:
        this.mode({ ...profile, apiKey }) === "model"
          ? MODEL_MATERIAL_LABEL
          : "联网检索资料",
      used: usage.used,
      usage,
    };
  }
  validated(input = {}) {
    const old = this.time.mind.repo.config("search-profile", {}),
      provider = input.provider || old.provider || "tavily";
    if (!ENDPOINTS[provider]) throw Error("搜索提供方无效");
    const next = { ...this.profile(provider), ...input, provider };
    if (typeof next.apiKey === "string") next.apiKey = next.apiKey.trim();
    if (
      typeof next.enabled !== "boolean" ||
      typeof next.apiKey !== "string" ||
      /[\r\n]/.test(next.apiKey) ||
      next.apiKey.length > 2000
    )
      throw Error("搜索配置格式无效");
    if (!next.apiKey) next.apiKey = this.profile(provider).apiKey.trim();
    if (input.clearKey) next.apiKey = "";
    const url = new URL(next.baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw Error("搜索地址无效");
    for (const [key, min, max] of [
      ["timeoutMs", 1000, 120000],
      ["maxResults", 1, 20],
      ["dailyLimit", 0, 100000],
    ])
      if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max)
        throw Error(key + " 超出范围");
    const profile = Object.fromEntries(
      Object.keys(SEARCH_DEFAULTS).map((key) => [key, next[key]]),
    );
    return { ...profile, provider };
  }
  save(input) {
    const profile = this.validated(input);
    const old = this.time.mind.repo.config("search-profile", {});
    this.time.mind.repo.saveConfig("search-profile", {
      provider: profile.provider,
      profiles: { ...old.profiles, [profile.provider]: profile },
    });
    this.wake();
    return this.public();
  }
  usage(now) {
    const day = dayKey(now, this.time.mind.timeZone());
    const rows = this.db
      .prepare(
        "SELECT created,state,purpose FROM mind_time_searches WHERE created<=? AND created>=?",
      )
      .all(now, now - 2 * 86400000)
      .filter((r) => dayKey(r.created, this.time.mind.timeZone()) === day);
    const activity = rows.filter((r) => r.purpose !== "diagnostic"),
      successful = activity.filter((r) => r.state === "done").length,
      running = activity.filter((r) => r.state === "running").length;
    return {
      used: successful + running,
      successful,
      running,
      failed: activity.filter((r) => r.state === "error").length,
      diagnostics: rows.filter((r) => r.purpose === "diagnostic").length,
    };
  }
  used(now) {
    return this.usage(now).used;
  }
  ready(now = this.time.now(), p = this.profile(), diagnostic = false) {
    if (!diagnostic && p.dailyLimit > 0 && this.used(now) >= p.dailyLimit)
      return "今日资料查询次数已用完";
    if (this.mode(p) === "model") {
      try {
        const model = this.life?.profile();
        if (!model || !(model.apiKey || process.env.LLM_API_KEY))
          return "等待可用模型";
        if (this.life.closed) return "等待可用模型";
      } catch {
        return "等待可用模型";
      }
    }
    return "";
  }
  async query(
    topic,
    {
      projectId = null,
      now = this.time.now(),
      trace,
      valid = () => true,
      profile = this.profile(),
      purpose = "activity",
    } = {},
  ) {
    if (!["activity", "diagnostic"].includes(purpose))
      throw Error("查询用途无效");
    const why = this.ready(now, profile, purpose === "diagnostic");
    if (why) throw Error(why);
    topic = text(topic, 180);
    if (
      !topic ||
      hasCredential(topic) ||
      /\b\d{5,}\b|(?:群|私聊|账号)\s*[:：=]/.test(topic)
    )
      throw Error("查询只能包含资料主题");
    const p = profile,
      id = Number(
        this.db
          .prepare(
            "INSERT INTO mind_time_searches(created,provider,query,state,purpose) VALUES (?,?,?,'running',?)",
          )
          .run(
            now,
            this.mode(p) === "model" ? "model" : p.provider,
            topic,
            purpose,
          ).lastInsertRowid,
      );
    const headers =
      p.provider === "tavily"
        ? {
            "Content-Type": "application/json",
            Authorization: "Bearer " + p.apiKey,
          }
        : { "X-Subscription-Token": p.apiKey, Accept: "application/json" };
    const endpoint = new URL(p.baseUrl);
    let body;
    if (p.provider === "tavily")
      body = JSON.stringify({
        query: topic,
        search_depth: "basic",
        max_results: p.maxResults,
        include_answer: false,
        include_raw_content: false,
      });
    else {
      endpoint.searchParams.set("q", topic);
      endpoint.searchParams.set("count", String(p.maxResults));
      endpoint.searchParams.set("extra_snippets", "true");
    }
    try {
      let results;
      if (this.mode(p) === "model") {
        results = await modelMaterial(this.life, topic, {
          trace,
          maxResults: p.maxResults,
        });
      } else {
        const response = await this.fetch(endpoint, {
          method: p.provider === "tavily" ? "POST" : "GET",
          headers,
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(p.timeoutMs),
          redirect: "error",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const detail =
            data.detail?.error ||
            data.error?.message ||
            (typeof data.error === "string" ? data.error : "");
          const hint = [401, 403].includes(response.status)
            ? "请核对独立密钥与权限"
            : [429, 432, 433].includes(response.status)
              ? "提供方限制了请求频率或账户额度"
              : [404, 405].includes(response.status)
                ? "请核对提供方与完整搜索地址"
                : "请检查搜索服务与请求配置";
          throw Error(`搜索接口 HTTP ${response.status}：${detail || hint}`);
        }
        const data = await response.json().catch(() => {
            throw Error("搜索接口未返回有效 JSON，请核对提供方与完整搜索地址");
          }),
          raw = p.provider === "tavily" ? data?.results : data?.web?.results;
        if (
          !Array.isArray(raw) &&
          !(p.provider === "brave" && data?.type === "search" && !data.web)
        )
          throw Error(
            "搜索返回格式与选定提供方不匹配，请核对提供方与完整搜索地址",
          );
        results = (Array.isArray(raw) ? raw : [])
          .slice(0, p.maxResults)
          .map((row) => ({
            kind: "web",
            model: "",
            uncertainty: "",
            timing: {},
            title: text(row.title, 200),
            url: String(row.url || ""),
            content: text(
              p.provider === "tavily"
                ? row.content
                : [row.description, ...(row.extra_snippets || [])]
                    .filter(Boolean)
                    .join("\n"),
              6000,
            ),
          }))
          .filter((row) => {
            try {
              return (
                ["https:", "http:"].includes(new URL(row.url).protocol) &&
                row.content &&
                !hasCredential(row.content)
              );
            } catch {
              return false;
            }
          });
      }
      if (!valid()) throw Error("任务已经变化，资料结果未提交");
      const saved = [];
      for (const row of results) {
        const hash = createHash("sha256").update(row.content).digest("hex"),
          sourceId = randomUUID();
        if (projectId) {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO mind_time_sources(id,project_id,created,title,url,content,hash,kind,model,uncertainty,timing) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              sourceId,
              projectId,
              now,
              row.title,
              row.url,
              row.content,
              hash,
              row.kind,
              row.model,
              row.uncertainty,
              JSON.stringify(row.timing || {}),
            );
          saved.push(
            this.db
              .prepare(
                "SELECT * FROM mind_time_sources WHERE project_id=? AND url=? AND hash=?",
              )
              .get(projectId, row.url, hash),
          );
        } else saved.push({ ...row, hash, created: now });
      }
      this.db
        .prepare("UPDATE mind_time_searches SET state='done' WHERE id=?")
        .run(id);
      return saved;
    } catch (error) {
      const network = describeNetworkError(error);
      const message =
        network.code === "TIMEOUT"
          ? "搜索连接超时，请检查网络、代理或增加超时"
          : network.code
            ? `搜索连接失败（${network.code}${network.detail ? "：" + network.detail : ""}），请检查网络和代理；代理状态改变后可重启实例`
            : String(error.message);
      const reason = sanitizeDetail(
        p.apiKey ? message.split(p.apiKey).join("[密钥已隐藏]") : message,
        300,
      );
      this.db
        .prepare(
          "UPDATE mind_time_searches SET state='error',error=? WHERE id=?",
        )
        .run(reason, id);
      throw Error(reason);
    }
  }
  async test(input = {}) {
    if (this.testing) {
      const error = Error("正在测试搜索连接，请稍后");
      error.status = 429;
      throw error;
    }
    this.testing = true;
    try {
      const profile = this.validated(input);
      const run = () =>
        this.query(SEARCH_TEST_TOPIC, { profile, purpose: "diagnostic" });
      const results =
        this.mode(profile) === "model"
          ? await this.time.attention.activity(run)
          : await run();
      if (results === null) throw Error("正在推进活动步骤，请稍后测试");
      return {
        results,
        profile: this.public(profile.provider, profile),
        diagnostic: true,
      };
    } finally {
      this.testing = false;
    }
  }
  sources(projectId) {
    return this.db
      .prepare(
        "SELECT id,created,title,url,length(content) characters,hash,kind,model,uncertainty,timing FROM mind_time_sources WHERE project_id=? ORDER BY created DESC LIMIT 100",
      )
      .all(projectId);
  }
}
