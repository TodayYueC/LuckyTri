import { createHash, randomUUID } from "node:crypto";
import { dayKey, hasCredential, text } from "../util.js";
import { describeNetworkError, sanitizeDetail } from "../../core/network.js";
import { modelMaterial, MODEL_MATERIAL_LABEL } from "./model-material.js";
import { storedModels } from "../../core/model-manager.js";
export const SEARCH_DEFAULTS = {
  enabled: true,
  provider: "tavily",
  baseUrl: "https://api.tavily.com/search",
  apiKey: "",
  timeoutMs: 20000,
  maxResults: 5,
  dailyLimit: 12,
  reuseChatKey: false,
  // DeepSeek official Search API by default; Responses web_search is optional.
  apiStyle: "search",
};
const ENDPOINTS = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  deepseek: "https://api.deepseek.com/v1/tools/search",
};
const DEEPSEEK_RESPONSES = "https://api.deepseek.com/responses";
const DEEPSEEK_WEB_SEARCH_MODEL = "deepseek-v4-pro";
export const SEARCH_PROVIDERS = Object.keys(ENDPOINTS);
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
    const key =
      profile.provider === "deepseek"
        ? this.resolveApiKey(profile)
        : profile.apiKey;
    return profile.enabled && key ? "web" : "model";
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
    if (chosen === "deepseek") {
      profile.apiStyle =
        profile.apiStyle === "responses" ? "responses" : "search";
      profile.baseUrl =
        profile.apiStyle === "responses"
          ? "https://api.deepseek.com"
          : ENDPOINTS.deepseek;
    }
    // Existing keys may have been pasted with padding before save normalized it.
    // Activity reads and connection tests must use the same credential bytes.
    return { ...profile, apiKey: profile.apiKey.trim() };
  }
  // Optional: reuse a DeepSeek chat model key when search-profile has none.
  resolveApiKey(profile = this.profile()) {
    const own = String(profile.apiKey || "").trim();
    if (own) return own;
    if (profile.provider !== "deepseek" || !profile.reuseChatKey) return "";
    const models = storedModels(this.time.mind.repo) || [];
    const hit = models.find((m) => {
      const provider = String(m.provider || "").toLowerCase();
      const base = String(m.baseUrl || "").toLowerCase();
      return (
        !!m.apiKey &&
        (provider === "deepseek" || base.includes("api.deepseek.com"))
      );
    });
    return hit?.apiKey ? String(hit.apiKey).trim() : "";
  }
  public(provider, testedProfile) {
    const { apiKey, ...profile } = testedProfile || this.profile(provider);
    const full = { ...profile, apiKey };
    const own = String(full.apiKey || "").trim();
    const effectiveKey =
      full.provider === "deepseek" ? this.resolveApiKey(full) : apiKey;
    const keySource =
      full.provider !== "deepseek"
        ? own
          ? "own"
          : "none"
        : own
          ? "own"
          : effectiveKey
            ? "reuse"
            : "none";
    const usage = this.usage(this.time.now());
    return {
      ...profile,
      hasApiKey: !!effectiveKey,
      keySource,
      reuseChatKey: !!full.reuseChatKey,
      apiStyle: full.apiStyle || SEARCH_DEFAULTS.apiStyle,
      mode: this.mode(full),
      materialLabel:
        this.mode(full) === "model"
          ? MODEL_MATERIAL_LABEL
          : full.provider === "deepseek"
            ? "DeepSeek 原生联网"
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
    if (provider === "deepseek") {
      if (typeof next.reuseChatKey !== "boolean") next.reuseChatKey = false;
      next.apiStyle = next.apiStyle === "responses" ? "responses" : "search";
      next.baseUrl =
        next.apiStyle === "responses"
          ? "https://api.deepseek.com"
          : ENDPOINTS.deepseek;
    } else {
      next.reuseChatKey = false;
      next.apiStyle = SEARCH_DEFAULTS.apiStyle;
    }
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
    const p = {
      ...profile,
      apiKey:
        profile.provider === "deepseek"
          ? this.resolveApiKey(profile)
          : profile.apiKey,
    };
    if (
      p.provider === "deepseek" &&
      p.apiStyle !== "responses" &&
      Array.from(topic).length > 128
    )
      throw Error("DeepSeek Search 查询最多 128 个字符");
    const id = Number(
      this.db
        .prepare(
          "INSERT INTO mind_time_searches(created,provider,query,state,purpose) VALUES (?,?,?,'running',?)",
        )
        .run(
          now,
          this.mode(profile) === "model" ? "model" : p.provider,
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
        : p.provider === "deepseek"
          ? {
              "Content-Type": "application/json",
              Authorization: "Bearer " + p.apiKey,
            }
          : { "X-Subscription-Token": p.apiKey, Accept: "application/json" };
    let endpoint = new URL(
      p.provider === "deepseek"
        ? p.apiStyle === "responses"
          ? DEEPSEEK_RESPONSES
          : ENDPOINTS.deepseek
        : p.baseUrl,
    );
    let body;
    let method = "GET";
    if (p.provider === "tavily") {
      method = "POST";
      body = JSON.stringify({
        query: topic,
        search_depth: "basic",
        max_results: p.maxResults,
        include_answer: false,
        include_raw_content: false,
      });
    } else if (p.provider === "deepseek") {
      method = "POST";
      if (p.apiStyle === "responses") {
        body = JSON.stringify({
          model: DEEPSEEK_WEB_SEARCH_MODEL,
          max_output_tokens: 1024,
          tools: [{ type: "web_search" }],
          input: `请检索并列出与下列主题最相关的公开网页资料，优先权威来源：${topic}`,
        });
      } else {
        body = JSON.stringify({
          query: topic,
          count: p.maxResults,
          need_content: true,
        });
      }
    } else {
      endpoint.searchParams.set("q", topic);
      endpoint.searchParams.set("count", String(p.maxResults));
      endpoint.searchParams.set("extra_snippets", "true");
    }
    try {
      let results;
      if (this.mode(profile) === "model") {
        results = await modelMaterial(this.life, topic, {
          trace,
          maxResults: p.maxResults,
        });
      } else {
        const response = await this.fetch(endpoint, {
          method,
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
            ? p.provider === "deepseek"
              ? "请核对 DeepSeek API Key 或「复用对话密钥」配置"
              : "请核对独立密钥与权限"
            : response.status === 402 && p.provider === "deepseek"
              ? "DeepSeek Search 账户余额不足"
              : [429, 432, 433].includes(response.status)
                ? "提供方限制了请求频率或账户额度"
                : [404, 405].includes(response.status)
                  ? "请核对提供方与完整搜索地址"
                  : "请检查搜索服务与请求配置";
          throw Error(`搜索接口 HTTP ${response.status}：${detail || hint}`);
        }
        const data = await response.json().catch(() => {
          throw Error("搜索接口未返回有效 JSON，请核对提供方与完整搜索地址");
        });
        if (p.provider === "deepseek") {
          results = mapDeepSeekSearchResults(data, p.maxResults);
        } else {
          const raw =
            p.provider === "tavily" ? data?.results : data?.web?.results;
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

// DeepSeek search → unified sources (Anthropic tool_result or Responses output).
export function mapDeepSeekSearchResults(data, maxResults = 5) {
  const rows = [];
  const pushItem = (item) => {
    const url = String(item?.url || item?.link || "");
    const title = text(item?.title || item?.url || "", 200);
    const snippet = text(
      item?.content ||
        item?.summary ||
        item?.snippet ||
        item?.description ||
        "",
      6000,
    );
    const cited = Array.isArray(item?.citations) ? item.citations : [];
    for (const c of cited) {
      if (c?.url)
        rows.push({
          kind: "web",
          model: "deepseek",
          uncertainty: "",
          timing: {},
          title: text(c.title || c.url, 200),
          url: String(c.url),
          content: text(c.snippet || c.content || snippet || title, 6000),
        });
    }
    if (url)
      rows.push({
        kind: "web",
        model: "deepseek",
        uncertainty: "",
        timing: {},
        title: title || url,
        url,
        content: snippet || title || url,
      });
  };
  for (const item of Array.isArray(data?.results) ? data.results : [])
    pushItem(item);
  const blocks = Array.isArray(data?.content) ? data.content : [];
  for (const block of blocks) {
    if (block?.type !== "web_search_tool_result") continue;
    const content = Array.isArray(block.content) ? block.content : [];
    for (const item of content) pushItem(item);
  }
  // Responses API: output items may include web_search_call / message citations.
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (item?.type === "web_search_call") {
      const action = item.action || {};
      const sources = Array.isArray(action.sources)
        ? action.sources
        : Array.isArray(item.sources)
          ? item.sources
          : [];
      for (const s of sources) pushItem(s);
      if (action.url || item.url)
        pushItem({
          url: action.url || item.url,
          title: action.title || item.title || "",
          snippet: action.snippet || item.snippet || "",
        });
    }
    if (item?.type === "message") {
      for (const part of item.content || []) {
        for (const ann of part.annotations || []) {
          if (ann?.url) pushItem(ann);
        }
        if (Array.isArray(part.citations))
          for (const c of part.citations) pushItem(c);
      }
    }
  }
  const cleaned = [];
  const seen = new Set();
  for (const row of rows) {
    try {
      const url = new URL(row.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      if (!row.content || hasCredential(row.content)) continue;
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      cleaned.push(row);
      if (cleaned.length >= maxResults) break;
    } catch {
      /* skip bad url */
    }
  }
  if (!cleaned.length)
    throw Error(
      "DeepSeek 未返回可用网页结果；请核对 Search API 权限、账户余额和查询主题",
    );
  return cleaned;
}
