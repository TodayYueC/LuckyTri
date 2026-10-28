import { interestTerms } from "./attention.js";
import { evidenceRoots, externalEvidence } from "./evidence.js";
import { normalized, parse, similar } from "./util.js";

// Surface wording can change while the idea remains the same. This modest
// overlap check is used only for recent self-initiated speech; it is not a
// general claim that two conversations have the same meaning.
export function sameRecentTheme(a, b) {
  if (similar(a, b)) return true;
  const left = normalized(a);
  const right = normalized(b);
  if (left.length < 10 || right.length < 10) return false;
  const grams = (value) =>
    new Set(
      Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
    );
  const x = grams(left);
  const y = grams(right);
  const shared = [...x].filter((gram) => y.has(gram)).length;
  return shared >= 5 && shared / Math.min(x.size, y.size) >= 0.32;
}

// Canonical alias seeds for well-known works and terms, while the association
// graph below generalizes to any new work, novel, game or creative project
// through title extraction, morphological scene stems, and co-occurrence.
const CANONICAL_ALIASES = new Map([
  ["传送门", "portal-fanfic"],
  ["传送门2", "portal-fanfic"],
  ["portal", "portal-fanfic"],
  ["portal2", "portal-fanfic"],
  ["焚化炉", "portal-fanfic"],
  ["老光圈", "portal-fanfic"],
  ["rattmann", "portal-fanfic"],
  ["补课笔记", "portal-fanfic"],
  ["卡罗琳", "portal-fanfic"],
  ["caroline", "portal-fanfic"],
  ["惠特利", "portal-fanfic"],
  ["wheatley", "portal-fanfic"],
  ["glados", "portal-fanfic"],
  ["空洞骑士", "hollow-knight"],
  ["守梦者", "hollow-knight"],
  ["赫拉", "hollow-knight"],
  ["圣巢", "hollow-knight"],
  ["少女歌剧", "revue-starlight"],
]);

// Bounded dynamic co-occurrence graph mapping topic keys -> canonical cluster key.
const MAX_LEARNED_LINKS = 600;
const learnedLinks = new Map();

function normalizeWorkStem(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(
      /(?:第\s*[\d零〇一二两三四五六七八九十百]+\s*[章节段幕格篇关卷回部]|连载|短篇|长篇|初稿|草稿|修改稿|完成稿|正文|笔记|节拍|进度|大纲|设定|小段|片段|部分)+$/u,
      "",
    )
    .replace(/[\s·:：—\-_，,。！？!?《》「」『』"“”'‘’（）()[\]]+/gu, "")
    .trim();
}

function resolveCanonical(key) {
  if (!key) return "";
  if (CANONICAL_ALIASES.has(key)) return CANONICAL_ALIASES.get(key);
  let cur = key;
  const visited = new Set();
  while (learnedLinks.has(cur) && !visited.has(cur)) {
    visited.add(cur);
    cur = learnedLinks.get(cur);
  }
  return CANONICAL_ALIASES.get(cur) || cur;
}

function linkKeys(keys) {
  const clean = [
    ...new Set(keys.map((k) => String(k || "").trim()).filter(Boolean)),
  ];
  if (clean.length < 2) return;
  const canonical =
    clean.find((k) => !k.includes(":")) ||
    clean.find((k) => k.startsWith("title:")) ||
    clean[0];
  for (const key of clean) {
    if (key === canonical) continue;
    // Do not overwrite an already-established link to a different work family.
    if (learnedLinks.has(key) && learnedLinks.get(key) !== canonical) continue;
    if (learnedLinks.size >= MAX_LEARNED_LINKS) {
      const oldest = learnedLinks.keys().next().value;
      if (oldest) learnedLinks.delete(oldest);
    }
    learnedLinks.set(key, canonical);
  }
}

const GENERIC_STEMS = new Set([
  "今天",
  "今晚",
  "明天",
  "明早",
  "昨晚",
  "刚才",
  "刚刚",
  "最近",
  "现在",
  "这会儿",
  "那段",
  "这段",
  "那格",
  "这格",
  "那篇",
  "这篇",
  "那章",
  "这章",
  "小说",
  "故事",
  "短篇",
  "长篇",
  "连载",
  "游戏",
  "作品",
  "文章",
  "资料",
  "正文",
  "草稿",
  "初稿",
  "时候",
  "地方",
  "东西",
  "事情",
  "问题",
  "感觉",
  "心情",
  "大家",
  "朋友",
  "群里",
  "私聊",
  "进度",
  "节拍",
  "笔记",
  "安排",
  "计划",
  "时间",
  "部分",
  "内容",
  "方向",
  "场景",
  "走廊",
  "长廊",
  "房间",
  "大厅",
  "客厅",
  "卧室",
  "教室",
  "办公室",
]);

function extractRawTopicKeys(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const rawKeys = new Set();

  // 1. Canonical alias hits & already-learned topic keys
  const lower = raw.toLowerCase();
  for (const [alias, family] of CANONICAL_ALIASES.entries()) {
    if (lower.includes(alias)) rawKeys.add(family);
  }
  for (const [learnedKey, family] of learnedLinks.entries()) {
    const bare = learnedKey.replace(/^title:/, "");
    if (bare.length >= 2 && lower.includes(bare)) {
      rawKeys.add(learnedKey);
      rawKeys.add(family);
    }
  }

  // 2. Explicit bracketed / quoted work titles: 《...》, 「...」, 『...』
  for (const m of raw.matchAll(/[《「『]([^》」』]{2,28})[》」』]/g)) {
    const exact = m[1].trim();
    const stem = normalizeWorkStem(exact);
    if (exact.length >= 2) rawKeys.add(`title:${exact}`);
    if (stem.length >= 2 && !GENERIC_STEMS.has(stem)) {
      if (CANONICAL_ALIASES.has(stem)) rawKeys.add(CANONICAL_ALIASES.get(stem));
      rawKeys.add(`title:${stem}`);
    }
  }

  // 3. Activity verb + work/scene object (e.g. "读传送门2第38段", "排焚化炉节拍", "写雨夜灯塔第2章")
  for (const m of raw.matchAll(
    /(?:读完|写完|玩完|看完|排完|正在读|正在写|正在玩|在读|在写|在玩|在看|在排|继续读|继续写|继续玩|继续排|准备读|准备写|打算读|打算写|读|写|玩|排|重温|补课|续写|接续)\s*[《「『]?([\u4e00-\u9fffA-Za-z0-9]{2,12}?)[》」』]?\s*(?:的)?(?:第\s*[\d零〇一二两三四五六七八九十百]+\s*[章节段幕格篇关卷回部]|节拍|进度|笔记|走廊|场景|那段|那格|那章|初稿|草稿|正文|结局|开篇|支线|主线)/giu,
  )) {
    const stem = normalizeWorkStem(m[1]).replace(
      /^(?:全是|都是|一段|一篇|一格|一下|一点)/u,
      "",
    );
    if (stem.length >= 2 && !GENERIC_STEMS.has(stem)) {
      if (CANONICAL_ALIASES.has(stem)) rawKeys.add(CANONICAL_ALIASES.get(stem));
      else rawKeys.add(`title:${stem}`);
    }
  }

  // 4. Creative / setting location or work stems in activity or pushback contexts
  // (e.g. "焚化炉", "太阳站", "旧灯塔", "总闸房", "星露谷", "夜之城")
  if (
    /写|读|玩|排|改|章|节|段|篇|幕|格|稿|设定|剧情|场景|角色|通关|笔记|节拍|补课|连载|还在|又是/u.test(
      raw,
    )
  ) {
    const cleanedRaw = raw.replace(
      /(?:修改|续写|接续|重温|补课|整理|准备|打算|继续|刚把|刚写完|写完|读完|玩完|看完|排完|还在|又是|那段|这段|那个|这个|今晚|今天|刚才|[在从到把给向对跟和与的了着过是让被由往于])/gu,
      " ",
    );
    for (const m of cleanedRaw.matchAll(
      /([\u4e00-\u9fff]{1,4}?(?:炉|塔|站|馆|城|谷|岛|廊|墟|房|厅|室|传|记|剧|录))/gu,
    )) {
      const cleaned = m[1].replace(/^[把在去到从排写读看玩]+/u, "");
      const stem = normalizeWorkStem(cleaned);
      if (stem.length >= 2 && stem.length <= 6 && !GENERIC_STEMS.has(stem)) {
        if (CANONICAL_ALIASES.has(stem))
          rawKeys.add(CANONICAL_ALIASES.get(stem));
        else rawKeys.add(`title:${stem}`);
      }
    }
  }

  return [...rawKeys];
}

// Learn topic associations from a text or from Mind's active projects/works/tasks.
export function learnTopicAssociations(input) {
  if (!input) return;
  if (typeof input === "string") {
    const keys = extractRawTopicKeys(input);
    if (keys.length >= 2) linkKeys(keys);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) learnTopicAssociations(item);
    return;
  }
  if (typeof input === "object") {
    // If a database or mind-like object is passed, harvest active projects & works
    const db = input.db || input.mind?.db;
    if (db?.prepare) {
      try {
        for (const p of db
          .prepare(
            "SELECT title,summary,bible FROM mind_time_projects ORDER BY updated DESC LIMIT 30",
          )
          .all()) {
          const bible = parse(p.bible, {});
          const combined = [
            p.title,
            p.summary,
            bible.topic,
            bible.world,
            bible.characters,
          ]
            .filter(Boolean)
            .join(" ");
          const keys = extractRawTopicKeys(combined);
          if (keys.length >= 2) linkKeys(keys);
        }
      } catch {
        /* ignore if table not ready */
      }
    }
    const textFields = [
      input.title,
      input.project_title,
      input.topic,
      input.summary,
      input.content,
      input.text,
      input.outreach,
      input.why,
    ]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" ");
    if (textFields) {
      const keys = extractRawTopicKeys(textFields);
      if (keys.length >= 2) linkKeys(keys);
    }
  }
}

export function workFamilies(text, context = null) {
  if (context) learnTopicAssociations(context);
  const raw = String(text || "");
  const extracted = extractRawTopicKeys(raw);
  if (extracted.length >= 2) linkKeys(extracted);
  const out = new Set();
  for (const key of extracted) {
    out.add(key);
    out.add(resolveCanonical(key));
  }
  return [...out].filter(Boolean);
}

export function sameWorkFamily(a, b, context = null) {
  const left = workFamilies(a, context);
  const right = workFamilies(b, context);
  if (!left.length || !right.length) return false;
  return left.some((key) => right.includes(key));
}

// Live 2026-10-28/29 Tokyo presence: portal2-caroline 族近义连播——读资料/看概要/翻笔记
// 反复「惠特利背叛 vs 卡罗琳删除 / 停笔进稿子」。novelty 把新 `r:` 根当成 new_discovery，
// 但主张指纹相同。结构上用实体+主张词重叠判定同一洞察，而不是堆一句黑名单。
const CLAIM_ACTION_STEMS = new Set([
  "删除",
  "删了",
  "删掉",
  "背叛",
  "停笔",
  "进稿",
  "进稿子",
  "正主",
  "护短",
]);

export function insightClaimStems(text) {
  const raw = String(text || "");
  if (!raw.trim()) return new Set();
  const stems = new Set();
  for (const t of interestTerms([raw])) {
    if (!GENERIC_STEMS.has(t) && String(t).length >= 2) stems.add(t);
  }
  for (const w of raw.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []) {
    stems.add(w.toLowerCase());
  }
  for (const m of raw.matchAll(/[「『“"]([^」』”"\n]{2,10})[」』”"]/g)) {
    const quoted = m[1].trim();
    if (quoted.length >= 2 && !GENERIC_STEMS.has(quoted)) {
      stems.add(`quote:${quoted}`);
    }
  }
  // Keep whole multi-char Chinese name/entity runs (not only bigrams) when distinctive.
  for (const run of raw.match(/[\u4e00-\u9fff]{2,6}/g) || []) {
    if (GENERIC_STEMS.has(run)) continue;
    if (run.length >= 3) stems.add(run);
  }
  for (const action of CLAIM_ACTION_STEMS) {
    if (raw.includes(action)) stems.add(action);
  }
  return stems;
}

export function sameInsightClaim(a, b) {
  const left = insightClaimStems(a);
  const right = insightClaimStems(b);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((s) => right.has(s));
  if (!shared.length) return false;
  const namedOrAction = shared.filter(
    (s) =>
      CLAIM_ACTION_STEMS.has(s) ||
      s.startsWith("quote:") ||
      s.length >= 3 ||
      /^[a-z][a-z0-9]{2,}$/i.test(s),
  );
  // ≥2 distinctive entity/claim stems → same articulated insight.
  if (namedOrAction.length >= 2) return true;
  // High distinctive interestTerms overlap on named stems (paraphrase with soft wording drift).
  const lt = interestTerms([String(a || "")]);
  const rt = interestTerms([String(b || "")]);
  const distinctive = [...lt].filter(
    (t) => rt.has(t) && !GENERIC_STEMS.has(t) && t.length >= 2,
  );
  const denom = Math.min(lt.size || 1, rt.size || 1);
  if (distinctive.length >= 4 && distinctive.length / denom >= 0.4) return true;
  // One strong named stem + one claim-action is enough (卡罗琳+删除).
  if (
    namedOrAction.length >= 1 &&
    shared.some((s) => CLAIM_ACTION_STEMS.has(s)) &&
    shared.some((s) => s.length >= 3 || /^[a-z]/i.test(s))
  )
    return true;
  return false;
}

const PROGRESS_BROADCAST_CUE =
  /进度|节拍|三格|补课|那格.{0,20}(?:起跑|又滑|滑了|排)|(?:又滑了|起跑).{0,20}(?:那格|第三|不硬撑)|跑完(?:跟你说|照旧)|排到哪了|第\s*[\d一二三四五六七八九十]+\s*(?:段|格|回)|存了\s*\d+\s*字|刚写完.{0,24}想给你看看|顺手报个进度/u;

const PUSHBACK_CUE =
  /还在.{0,16}(?:焚化炉|传送门|Portal|三格|补课|节拍|笔记|写|读|排)|怎么又(?:是|在)|别(?:再)?(?:说|播|报)|听腻了|换(?:个|点)话题|总是在说你自己|谁问你了/i;

function textOfItem(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  return [
    item.title,
    item.topic,
    item.content,
    item.said,
    item.outreach,
    item.text,
    ...(Array.isArray(item.words) ? item.words : []),
  ]
    .filter((x) => typeof x === "string" && x.trim())
    .join("\n");
}

function sourcesOfItem(item) {
  if (!item || typeof item !== "object") return [];
  if (Array.isArray(item.sources)) return item.sources.map(String);
  if (typeof item.sources === "string")
    return parse(item.sources, []).map(String);
  return [];
}

/**
 * General 5-way topic relation classifier:
 * Distinguishes:
 * 1. "repeat_restatement": 同一件事的重复复述 (suppress: true)
 * 2. "stagnant_progress": 同一作品没有实质变化的进度播报 (suppress: true)
 * 3. "new_discovery": 同一长期兴趣下产生的新发现 (suppress: false)
 * 4. "revived_by_experience": 旧话题因为新经历而重新具有交流价值 (suppress: false)
 * 5. "shared_continuation": 与某个人自然延续此前的交流 (suppress: false)
 * Plus "unrelated" when topics are distinct.
 */
export function classifyTopicRelation(previous, candidate, options = {}) {
  const {
    db = null,
    now = Date.now(),
    peerRecentTexts = [],
    peerEngaged = false,
  } = options;
  if (db) learnTopicAssociations({ db });

  const prevText = textOfItem(previous);
  const candText = textOfItem(candidate);
  if (!prevText || !candText) {
    return {
      sameTopic: false,
      relation: "unrelated",
      suppress: false,
      families: [],
      reason: "",
    };
  }

  const prevFamilies = workFamilies(prevText);
  const candFamilies = workFamilies(candText);
  const sharedFamilies = candFamilies.filter((f) => prevFamilies.includes(f));
  const sameProject =
    previous?.projectId &&
    candidate?.projectId &&
    previous.projectId === candidate.projectId;
  const sameWork =
    previous?.workId &&
    candidate?.workId &&
    previous.workId === candidate.workId;

  const prevSources = sourcesOfItem(previous);
  const candSources = sourcesOfItem(candidate);
  const prevRoots =
    db && prevSources.length
      ? new Set(evidenceRoots(db, prevSources, now))
      : new Set(prevSources);
  const candRoots =
    db && candSources.length
      ? evidenceRoots(db, candSources, now)
      : candSources;
  const sharesAllRoots =
    candRoots.length > 0 &&
    prevRoots.size > 0 &&
    candRoots.every((r) => prevRoots.has(r));

  const themeOverlap = sameRecentTheme(prevText, candText);
  const workOverlap =
    sharedFamilies.length > 0 || Boolean(sameProject) || Boolean(sameWork);

  // Check if two texts about creative/reading/gaming activities share core subject terms
  let subjectOverlap = false;
  if (!themeOverlap && !workOverlap) {
    const leftTerms = interestTerms([prevText]);
    const rightTerms = interestTerms([candText]);
    const distinctive = [...leftTerms].filter(
      (t) => rightTerms.has(t) && !GENERIC_STEMS.has(t) && t.length >= 2,
    );
    if (
      distinctive.length >= 3 &&
      distinctive.length /
        Math.min(leftTerms.size || 1, rightTerms.size || 1) >=
        0.35
    ) {
      subjectOverlap = true;
    }
  }

  const claimSame = sameInsightClaim(prevText, candText);

  if (!themeOverlap && !workOverlap && !subjectOverlap && !claimSame) {
    return {
      sameTopic: false,
      relation: "unrelated",
      suppress: false,
      families: candFamilies,
      reason: "",
    };
  }

  // Check whether the peer pushed back vs naturally engaged on this topic
  const peerPushedBack = peerRecentTexts.some((t) =>
    PUSHBACK_CUE.test(String(t || "")),
  );
  const peerMentionedTopic =
    !peerPushedBack &&
    (peerEngaged ||
      peerRecentTexts.some((t) => {
        const line = String(t || "");
        if (!line || PUSHBACK_CUE.test(line)) return false;
        return (
          sameWorkFamily(line, candText) || sameRecentTheme(line, candText)
        );
      }));

  // 1. Exact or near-exact restatement of the same words
  if (similar(prevText, candText, 0.72)) {
    return {
      sameTopic: true,
      relation: "repeat_restatement",
      suppress: true,
      families: sharedFamilies,
      reason: "同一件事的重复复述",
    };
  }

  // 2. Peer naturally engaged on this topic -> natural continuation (unless verbatim repeat above)
  if (peerMentionedTopic) {
    return {
      sameTopic: true,
      relation: "shared_continuation",
      suppress: false,
      families: sharedFamilies,
      reason: "与对方自然延续此前的共同话题",
    };
  }

  // Determine whether candidate has genuinely new external roots or new reading/discovery
  const freshExternalRoots = db
    ? externalEvidence(db, candSources, now).filter((r) => !prevRoots.has(r))
    : candRoots.filter(
        (r) =>
          !prevRoots.has(r) &&
          (r.startsWith("m:") ||
            r.startsWith("r:") ||
            r.startsWith("o:") ||
            r.startsWith("e:") ||
            r.startsWith("a:")),
      );
  const hasNewMessageOrEvent = freshExternalRoots.some(
    (r) =>
      r.startsWith("m:") ||
      r.startsWith("o:") ||
      r.startsWith("e:") ||
      r.startsWith("a:"),
  );
  const hasNewReading = freshExternalRoots.some((r) => r.startsWith("r:"));
  const isProgressDump = PROGRESS_BROADCAST_CUE.test(candText);

  // 3. Stagnant progress broadcast on the same work/project without new external conversation/event
  if (isProgressDump && !hasNewMessageOrEvent) {
    return {
      sameTopic: true,
      relation: "stagnant_progress",
      suppress: true,
      families: sharedFamilies,
      reason: "同一作品没有实质变化的排程或进度播报",
    };
  }

  // 4. Revived by a new external experience (new user message, observation, or due episode/anticipation)
  if (hasNewMessageOrEvent && !themeOverlap) {
    return {
      sameTopic: true,
      relation: "revived_by_experience",
      suppress: false,
      families: sharedFamilies,
      reason: "旧话题因新的外部经历或事件重新具有交流价值",
    };
  }

  // Same articulated insight (entity+claim fingerprint) is a restatement even when a
  // fresh reading root `r:` appeared — paraphrasing 惠特利背叛/卡罗琳删除 is not a discovery.
  if (claimSame) {
    return {
      sameTopic: true,
      relation: "repeat_restatement",
      suppress: true,
      families: sharedFamilies,
      reason: "同一主张的近义复述；新阅读根不能把同一洞察当成新发现",
    };
  }

  // 5. New discovery under a long-term interest (e.g., new reading passage `r:` with distinct wording)
  if (hasNewReading && !themeOverlap && !isProgressDump) {
    return {
      sameTopic: true,
      relation: "new_discovery",
      suppress: false,
      families: sharedFamilies,
      reason: "同一长期兴趣下产生的新阅读与新发现",
    };
  }

  // 6. Same theme or identical evidence roots with no new external basis
  if (themeOverlap || sharesAllRoots) {
    return {
      sameTopic: true,
      relation: "repeat_restatement",
      suppress: true,
      families: sharedFamilies,
      reason: "同一件事的重复复述，缺少新的经历支撑",
    };
  }

  // 7. Same work family within short window without new discovery or external experience
  return {
    sameTopic: true,
    relation: "stagnant_progress",
    suppress: true,
    families: sharedFamilies,
    reason: "同一作品短窗内尚无新的外部经历或新发现",
  };
}
