// Her life, read back as numbers: is she continuous, does her past reach her
// present, does she change for reasons, does her quiet time produce
// anything. No model, no tokens, no writes: the database (best: a backup
// file) is opened read-only and the report goes to data/reports/.
//
//   npm run audit:life -- --db "data/backups/luckytri-….db"
//   node scripts/dev/audit-life.js --db <备份文件> [--out <目录>] [--now <ISO 时间>]
//
// Every number is computed from what is stored; nothing is estimated. A
// table that an older database does not have is reported as unavailable.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evidenceRoots } from "../../server/mind/evidence.js";
import { aftermathOf, describeAftermath } from "../../server/mind/aftermath.js";

const DAY = 86400000;
// Kinds that may begin without a source (see SELF_ORIGINATED in self.js).
const SELF_ORIGINATED = new Set(["interest", "curiosity", "intention"]);
const SOURCE_TABLES = [
  ["mind_self", "自我线索"],
  ["mind_thoughts", "手记"],
  ["mind_meetings", "相遇"],
  ["mind_bond_events", "关系变化"],
  ["mind_episodes", "情景"],
  ["mind_affect", "心境"],
];
// Which stored row a citation points at. Other kinds (readings, tasks,
// observations…) are counted but not checked here.
const CHECKS = {
  m: ["core_events", "seq"],
  t: ["mind_thoughts", "id"],
  g: ["mind_meetings", "id"],
  s: ["mind_self", "thread"],
  a: ["mind_anticipations", "id"],
};
const CHOICE = {
  speak: "开口",
  react: "简短反应",
  decline: "说不想聊",
  silent: "不出声",
};

const parse = (value, fallback = []) => {
  try {
    const out = JSON.parse(value);
    return out ?? fallback;
  } catch {
    return fallback;
  }
};
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const days = (ms) => (ms == null ? null : Math.round((ms / DAY) * 10) / 10);
// The day in Asia/Shanghai, where her life is lived.
const localDay = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const share = (part, whole) =>
  whole ? Math.round((part / whole) * 1000) / 10 : null;

// A source list as citation tokens ("m:12", "t:abc"…), as evidence() reads it.
function refs(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (Number.isSafeInteger(item) && item > 0) out.push(`m:${item}`);
    else if (typeof item === "string" && /^[a-z]:[\w:.-]{1,80}$/.test(item))
      out.push(item);
    else if (/^\d+$/.test(String(item))) out.push(`m:${item}`);
    else if (item && typeof item === "object" && Number(item.id) > 0)
      out.push(`m:${Number(item.id)}`);
  }
  return [...new Set(out)];
}

export function auditLife(db, { now } = {}) {
  const has = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  );
  const columns = (table) =>
    has.has(table)
      ? new Set(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((c) => c.name),
        )
      : new Set();
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const latestEvent = has.has("core_events")
    ? get("SELECT MIN(time) first, MAX(time) last, COUNT(*) n FROM core_events")
    : { first: null, last: null, n: 0 };
  const at = Number.isFinite(now) ? now : latestEvent.last || Date.now();
  const sections = [];
  const problems = [];
  const section = (key, title, trait, build) => {
    const metrics = [];
    const put = (label, value, note = "") =>
      metrics.push({ label, value, note });
    try {
      build(put);
    } catch (error) {
      put("（这一组无法计算）", null, error.message);
    }
    sections.push({ key, title, trait, metrics });
  };
  const exists = new Map();
  const found = (kind, id) => {
    const [table, column] = CHECKS[kind];
    if (!has.has(table)) return true;
    const key = `${kind}:${id}`;
    if (!exists.has(key))
      exists.set(
        key,
        !!get(
          `SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`,
          kind === "m" ? Number(id) : id,
        ),
      );
    return exists.get(key);
  };

  section("overview", "概览", "", (put) => {
    put(
      "记录起止",
      latestEvent.first
        ? `${iso(latestEvent.first)} → ${iso(latestEvent.last)}`
        : null,
    );
    put("消息与事件总数", latestEvent.n);
    if (has.has("mind_days"))
      put(
        "她过过的日子（有经历的生活日）",
        get("SELECT COUNT(*) n FROM mind_days WHERE lived=1").n,
      );
    if (has.has("mind_people"))
      put("认识的人", get("SELECT COUNT(*) n FROM mind_people").n);
    put("报告基准时间", iso(at), "默认取最后一条记录的时间");
  });

  section("integrity", "连续性与数据完整（底线）", "七、一", (put) => {
    let checked = 0;
    const broken = {};
    const unchecked = {};
    for (const [table, label] of [
      ...SOURCE_TABLES,
      ["core_memories", "人物记忆"],
    ]) {
      if (!has.has(table) || !columns(table).has("sources")) continue;
      for (const row of db.prepare(`SELECT sources FROM ${table}`).iterate())
        for (const ref of refs(parse(row.sources))) {
          const kind = ref[0];
          if (!CHECKS[kind]) {
            unchecked[kind] = (unchecked[kind] || 0) + 1;
            continue;
          }
          checked++;
          if (!found(kind, ref.slice(2)))
            broken[label] = (broken[label] || 0) + 1;
        }
    }
    const brokenTotal = Object.values(broken).reduce((s, n) => s + n, 0);
    put("检查过的来源引用", checked);
    put(
      "来源断链",
      brokenTotal,
      brokenTotal
        ? Object.entries(broken)
            .map(([k, n]) => `${k} ${n}`)
            .join("，") + "。可能来自用户主动删除的消息，也可能是数据问题"
        : "",
    );
    if (brokenTotal)
      problems.push(`有 ${brokenTotal} 条来源引用指向已不存在的记录`);
    if (Object.keys(unchecked).length)
      put(
        "未核对的来源种类",
        Object.entries(unchecked)
          .map(([k, n]) => `${k}:${n}`)
          .join("，"),
        "阅读、任务、观察等由其他模块核对",
      );
    let back = 0;
    if (has.has("mind_revocations")) {
      // Tombstones are stamped with the wall clock while her records use her
      // own clock, so "after" is measured from the revoked record itself.
      for (const tomb of all(
        "SELECT * FROM mind_revocations WHERE target_kind IN ('self','memory')",
      )) {
        if (tomb.target_kind === "self" && has.has("mind_self")) {
          const anchor =
            get(
              "SELECT MIN(created) t FROM mind_self WHERE thread=? AND content=?",
              tomb.target_id,
              tomb.content || "",
            ).t ??
            get(
              "SELECT MAX(created) t FROM mind_self WHERE thread=?",
              tomb.target_id,
            ).t ??
            tomb.created;
          back += get(
            "SELECT COUNT(*) n FROM mind_self WHERE created>? AND (thread=? OR (content=? AND content!=''))",
            anchor,
            tomb.target_id,
            tomb.content || "",
          ).n;
        } else if (tomb.target_kind === "memory" && has.has("core_memories")) {
          const anchor =
            get("SELECT created FROM core_memories WHERE id=?", tomb.target_id)
              ?.created ?? tomb.created;
          back += get(
            "SELECT COUNT(*) n FROM core_memories WHERE status='confirmed' AND (id=? OR (created>? AND subject||char(10)||content=?))",
            tomb.target_id,
            anchor,
            tomb.content || "",
          ).n;
        }
      }
      put("撤销后又回来的内容", back, "应当为 0");
      if (back) problems.push(`有 ${back} 条被撤销的自我线索或记忆又出现了`);
    }
    if (
      has.has("core_memories") &&
      columns("core_memories").has("superseded_by")
    ) {
      const chain = get(
        "SELECT COUNT(*) n FROM core_memories m WHERE m.status='superseded' AND (m.superseded_by IS NULL OR NOT EXISTS (SELECT 1 FROM core_memories n WHERE n.id=m.superseded_by))",
      ).n;
      put("被取代却找不到新版本的记忆", chain, "应当为 0");
      if (chain) problems.push(`有 ${chain} 条被取代的记忆找不到取代它的那条`);
    }
    if (
      has.has("core_memories") &&
      columns("core_memories").has("discretion")
    ) {
      const secrets = all(
        "SELECT content FROM core_memories WHERE discretion='secret' AND status!='deleted' AND length(content)>=8",
      );
      const texts = [
        ...(has.has("mind_diary") ? all("SELECT content FROM mind_diary") : []),
        ...(has.has("mind_periods")
          ? all("SELECT content FROM mind_periods")
          : []),
        ...(has.has("mind_chapters")
          ? all("SELECT content FROM mind_chapters")
          : []),
      ].map((row) => String(row.content || ""));
      const leaked = secrets.filter((s) =>
        texts.some((t) => t.includes(s.content)),
      ).length;
      put(
        "保密记忆在日记、回顾、章节里原文复现",
        leaked,
        `检查了 ${secrets.length} 条保密记忆；只查原文复现，改写过的说法查不到`,
      );
      if (leaked)
        problems.push(`有 ${leaked} 条保密记忆的原文出现在日记或自传里`);
    }
  });

  section("self", "连续的自我", "一", (put) => {
    if (!has.has("mind_self"))
      return put("自我线索", null, "这份数据库没有 mind_self");
    const rows = all(
      "SELECT thread,kind,status,created,sources FROM mind_self ORDER BY created",
    );
    const revoked = new Set(
      has.has("mind_revocations")
        ? all(
            "SELECT target_id FROM mind_revocations WHERE target_kind='self'",
          ).map((r) => r.target_id)
        : [],
    );
    const threads = new Map();
    for (const row of rows) {
      const t = threads.get(row.thread) || { first: row.created, rows: [] };
      t.rows.push(row);
      threads.set(row.thread, t);
    }
    const current = [...threads.entries()].filter(
      ([id, t]) => !revoked.has(id) && t.rows.at(-1).status !== "closed",
    );
    const byKind = {};
    for (const [, t] of current)
      byKind[t.rows.at(-1).kind] = (byKind[t.rows.at(-1).kind] || 0) + 1;
    put(
      "仍在的自我线索",
      current.length,
      Object.entries(byKind)
        .map(([k, n]) => `${k} ${n}`)
        .join("，"),
    );
    put(
      "自我线索的版本总数",
      rows.length,
      "追加不覆盖，每次修正都是一个新版本",
    );
    const ages = current.map(([, t]) => at - t.first);
    put(
      "仍在线索的年龄（中位 / 最长，天）",
      ages.length
        ? `${days(quantile(ages, 0.5))} / ${days(Math.max(...ages))}`
        : null,
    );
    const sourced = rows.filter((r) => !SELF_ORIGINATED.has(r.kind));
    const withSource = sourced.filter(
      (r) => refs(parse(r.sources)).length,
    ).length;
    put(
      "需要依据的变化中有来源的比例",
      share(withSource, sourced.length) == null
        ? null
        : `${share(withSource, sourced.length)}%`,
      `${withSource}/${sourced.length}；看法、特质、习惯、放在心上、以后`,
    );
    if (has.has("mind_days")) {
      const lived = get("SELECT COUNT(*) n FROM mind_days WHERE lived=1").n;
      put(
        "每个生活日的自我变化",
        lived ? Math.round((rows.length / lived) * 100) / 100 : null,
        "新增、修正、放下都算",
      );
    }
    if (has.has("mind_chapters"))
      put(
        "自传章节（章 / 版本）",
        `${get("SELECT COUNT(DISTINCT chapter) n FROM mind_chapters").n} / ${get("SELECT COUNT(*) n FROM mind_chapters").n}`,
      );
    if (has.has("mind_periods"))
      put(
        "回顾与来路",
        all("SELECT level,COUNT(*) n FROM mind_periods GROUP BY level")
          .map((r) => `${r.level} ${r.n}`)
          .join("，") || 0,
      );
  });

  section("experience", "属于自己的经历", "二", (put) => {
    if (has.has("mind_episodes")) {
      const threads = all(
        `SELECT e.thread_id, e.status, MIN(a.created) first, MAX(a.created) last, COUNT(a.id) steps
         FROM mind_episodes e JOIN mind_episodes a ON a.thread_id=e.thread_id
         WHERE e.created=(SELECT MAX(created) FROM mind_episodes x WHERE x.thread_id=e.thread_id)
         GROUP BY e.thread_id`,
      );
      const status = {};
      for (const t of threads) status[t.status] = (status[t.status] || 0) + 1;
      put(
        "情景线程",
        threads.length,
        Object.entries(status)
          .map(([k, n]) => `${k} ${n}`)
          .join("，"),
      );
      const spans = threads
        .filter((t) => t.steps > 1)
        .map((t) => t.last - t.first);
      put(
        "多步线程的跨度（中位，天）",
        days(quantile(spans, 0.5)),
        `${spans.length} 条线程有不止一步`,
      );
    }
    if (has.has("mind_anticipations")) {
      const rows = all("SELECT kind,status,due_at FROM mind_anticipations");
      const tally = {};
      for (const r of rows) {
        const hers = ["promise", "plan"].includes(r.kind);
        const grace = (hers ? 7 : 3) * DAY;
        const state =
          r.status === "pending" && r.due_at < at - grace
            ? "missed(读取时算错过)"
            : r.status;
        const key = `${hers ? "她的" : "别人的"}${state}`;
        tally[key] = (tally[key] || 0) + 1;
      }
      put(
        "约定与期待",
        rows.length,
        Object.entries(tally)
          .map(([k, n]) => `${k} ${n}`)
          .join("，"),
      );
    }
    if (has.has("mind_links") && has.has("core_memories")) {
      const open = get(
        `SELECT COUNT(*) n FROM mind_links l
         JOIN core_memories a ON 'fact:'||a.id=l.from_id JOIN core_memories b ON 'fact:'||b.id=l.to_id
         WHERE l.relation='conflicts' AND a.status='confirmed' AND b.status='confirmed'`,
      ).n;
      put(
        "两边都还成立的冲突记忆",
        open,
        "冲突链接目前没有任何模块读取，这是待处理积压",
      );
      put(
        "经历之间的链接",
        all("SELECT relation,COUNT(*) n FROM mind_links GROUP BY relation")
          .map((r) => `${r.relation} ${r.n}`)
          .join("，") || 0,
      );
    }
    if (has.has("mind_choices") && columns("mind_choices").has("recalled")) {
      const rows = all(
        "SELECT created,recalled FROM mind_choices WHERE recalled!='[]'",
      );
      const happened = has.has("mind_index")
        ? db.prepare("SELECT happened FROM mind_index WHERE id=?")
        : null;
      const ages = [];
      const kinds = {};
      let cued = 0;
      for (const row of rows)
        for (const item of parse(row.recalled)) {
          const kind = String(item.id).split(":")[0];
          kinds[kind] = (kinds[kind] || 0) + 1;
          // Core self threads are always in view; they are who she is, not
          // something this moment brought back, so they stay out of the ages.
          if (item.why === "core") continue;
          cued++;
          const h = happened?.get(item.id)?.happened;
          if (h && h <= row.created) ages.push(row.created - h);
        }
      put(
        "记下了回忆的选择",
        rows.length,
        "回忆账本从本版本开始记录，更早的选择没有",
      );
      if (ages.length) {
        put(
          "被想起的过去的年龄（中位 / 90% / 最远，天）",
          `${days(quantile(ages, 0.5))} / ${days(quantile(ages, 0.9))} / ${days(Math.max(...ages))}`,
          `不含一直在场的核心自我线索；${cued} 条里 ${ages.length} 条能从回忆索引查到发生时间`,
        );
        put(
          "想起一周以前 / 一个月以前的比例",
          `${share(ages.filter((a) => a > 7 * DAY).length, ages.length)}% / ${share(ages.filter((a) => a > 30 * DAY).length, ages.length)}%`,
        );
      }
      if (Object.keys(kinds).length)
        put(
          "被想起的种类",
          Object.entries(kinds)
            .map(([k, n]) => `${k} ${n}`)
            .join("，"),
        );
    } else
      put("回忆账本", null, "这份数据库还没有 recalled 列（升级前的备份）");
  });

  section("links", "经历之间的关联", "二", (put) => {
    if (!has.has("mind_episodes") || !has.has("mind_thoughts"))
      return put("关联", null, "这份数据库没有情景或手记");
    // Recomputed from the sources themselves, so a backup from before the
    // derived roots table existed gives the same answer.
    const rootsOf = (refs) => new Set(evidenceRoots(db, refs));
    const thoughts = all("SELECT id FROM mind_thoughts WHERE hidden=0").map(
      (r) => ({ id: r.id, roots: rootsOf([`t:${r.id}`]) }),
    );
    const plans = has.has("mind_anticipations")
      ? all(
          "SELECT id FROM mind_anticipations WHERE kind IN ('promise','plan')",
        ).map((r) => ({ roots: rootsOf([`a:${r.id}`]) }))
      : [];
    const threads = new Map();
    for (const row of all("SELECT thread_id,sources FROM mind_episodes")) {
      const set = threads.get(row.thread_id) || new Set();
      for (const root of rootsOf(parse(row.sources))) set.add(root);
      threads.set(row.thread_id, set);
    }
    const hers = new Set(
      [...thoughts, ...plans].flatMap((item) => [...item.roots]),
    );
    const lived = new Set([...threads.values()].flatMap((r) => [...r]));
    const tied = [...threads.values()].filter((roots) =>
      [...roots].some((root) => hers.has(root)),
    ).length;
    put(
      "和她自己的手记或打算共享来源的情景线程",
      threads.size ? `${share(tied, threads.size)}%` : null,
      `${tied}/${threads.size}；只看来源是否相同，不判断内容是否相关`,
    );
    const lone = thoughts.filter(
      (t) => ![...t.roots].some((root) => lived.has(root)),
    ).length;
    put(
      "和任何情景都不共享来源的手记",
      thoughts.length ? `${share(lone, thoughts.length)}%` : null,
      `${lone}/${thoughts.length}；独处里的感想本来就常常不属于某件事`,
    );
    if (has.has("mind_choices") && columns("mind_choices").has("recalled")) {
      let linked = 0;
      let total = 0;
      for (const row of all(
        "SELECT recalled FROM mind_choices WHERE recalled!='[]'",
      ))
        for (const item of parse(row.recalled)) {
          total++;
          if (item.why === "linked") linked++;
        }
      put(
        "账本里因为关联而想起的条目",
        linked,
        `占全部 ${total} 条的 ${share(linked, total) ?? 0}%；关联回忆从第 2 轮开始`,
      );
    }
  });

  // What came after each choice: the stored record, or (on a database from
  // before it was kept) the same rule read on the spot without writing.
  const afterwards = (put) => {
    if (!has.has("core_events"))
      return put("选择与后果的对照", null, "没有消息记录，无法对照");
    const stored = columns("mind_choices").has("after");
    const rows = all(
      `SELECT id,created,session_id,choice,watermark${stored ? ",after" : ""} FROM mind_choices ORDER BY created DESC LIMIT 3000`,
    );
    let covered = 0;
    let derived = 0;
    let broken = 0;
    const spoke = { n: 0, answered: 0, corrected: 0, feedback: 0 };
    const silent = { n: 0, called: 0 };
    const samples = { answered: [], unanswered: [], corrected: [], called: [] };
    const textOf = db.prepare("SELECT payload FROM core_events WHERE seq=?");
    const said = (ref) => {
      try {
        const m = JSON.parse(
          textOf.get(Number(String(ref).slice(2)))?.payload || "{}",
        );
        return String(m.text || "").slice(0, 40);
      } catch {
        return "";
      }
    };
    for (const row of rows) {
      let after = stored && row.after ? parse(row.after) : null;
      if (!after) {
        after = aftermathOf(db, row, at);
        if (after) derived++;
      }
      if (!after) continue;
      covered++;
      for (const ref of after.refs || [])
        if (!found("m", String(ref).slice(2))) broken++;
      const day = localDay(row.created);
      if (after.spoke) {
        spoke.n++;
        if (after.answered) spoke.answered++;
        if (after.corrected) spoke.corrected++;
        if (after.feedback?.length) spoke.feedback++;
        const bucket = after.corrected
          ? "corrected"
          : after.answered
            ? "answered"
            : "unanswered";
        if (samples[bucket].length < 3)
          samples[bucket].push(
            `${day} ${describeAftermath(after)}${after.corrected ? `「${said(after.refs?.[0])}」` : ""}`,
          );
      } else {
        silent.n++;
        if (after.calledAgain) {
          silent.called++;
          if (samples.called.length < 3)
            samples.called.push(`${day} ${describeAftermath(after)}`);
        }
      }
    }
    if (broken) problems.push(`有 ${broken} 条“后来”引用的消息已不存在`);
    put(
      "选择与后果的对照",
      rows.length ? `${share(covered, rows.length)}%` : null,
      `${covered}/${rows.length}（其中 ${derived} 条是体检时按同一规则现算的，未写入）；窗口未关的不算`,
    );
    const pct = (a, b) => (b ? `${share(a, b)}%` : null);
    put(
      "开口后有人接话的比例",
      pct(spoke.answered, spoke.n),
      `${spoke.answered}/${spoke.n}；只认回复她或叫她的消息`,
    );
    put(
      "开口后可能被纠正的比例",
      pct(spoke.corrected, spoke.n),
      `${spoke.corrected}/${spoke.n}；按说法规则识别，只是提示`,
    );
    put(
      "沉默后又被叫到的比例",
      pct(silent.called, silent.n),
      `${silent.called}/${silent.n}`,
    );
    put("有管理台反馈的回复", spoke.feedback, "");
    for (const [key, label] of [
      ["answered", "抽样：有人接话"],
      ["unanswered", "抽样：没人接话"],
      ["corrected", "抽样：可能被纠正（附原话，供人工核对规则）"],
      ["called", "抽样：沉默后又被叫"],
    ])
      if (samples[key].length)
        put(label, samples[key].length, samples[key].join(" / "));
  };

  section("judgement", "判断与选择", "三", (put) => {
    if (!has.has("mind_choices")) return put("选择", null, "没有 mind_choices");
    const rows = all("SELECT choice,reason FROM mind_choices");
    const tally = {};
    for (const r of rows) tally[r.choice] = (tally[r.choice] || 0) + 1;
    put(
      "选择总数",
      rows.length,
      Object.entries(tally)
        .map(([k, n]) => `${CHOICE[k] || k} ${n}`)
        .join("，"),
    );
    const vague = rows.filter(
      (r) => !r.reason || ["此刻的判断", "没发出去"].includes(r.reason),
    ).length;
    put(
      "理由为空或是默认句的比例",
      share(vague, rows.length) == null
        ? null
        : `${share(vague, rows.length)}%`,
      `${vague}/${rows.length}`,
    );
    afterwards(put);
  });

  section("inner", "持续运转的内在世界", "四", (put) => {
    if (has.has("mind_runs")) {
      const rows = all(
        "SELECT kind,status,COUNT(*) n,SUM(tokens) tokens FROM mind_runs GROUP BY kind,status",
      );
      const byKind = {};
      for (const r of rows) {
        const k = (byKind[r.kind] ||= {
          n: 0,
          empty: 0,
          ok: 0,
          tokens: 0,
          statuses: {},
        });
        k.n += r.n;
        k.tokens += r.tokens || 0;
        k.statuses[r.status] = r.n;
        if (r.status === "empty") k.empty += r.n;
        if (["written", "state"].includes(r.status)) k.ok += r.n;
      }
      for (const [kind, k] of Object.entries(byKind))
        put(
          `后台运行：${kind}`,
          k.n,
          `${Object.entries(k.statuses)
            .map(([s, n]) => `${s} ${n}`)
            .join(
              "，",
            )}；有产出 ${share(k.ok, k.n) ?? 0}%，空转 ${share(k.empty, k.n) ?? 0}%；记账 token ${k.tokens}`,
        );
    }
    if (has.has("mind_thoughts")) {
      const rows = all(
        "SELECT outreach_status s,COUNT(*) n FROM mind_thoughts WHERE outreach_status!='none' GROUP BY outreach_status",
      );
      put(
        "主动联系的念头",
        rows.reduce((s, r) => s + r.n, 0),
        rows.map((r) => `${r.s} ${r.n}`).join("，"),
      );
    }
    if (has.has("mind_usage"))
      put(
        "Token 账本（输入 / 输出）",
        all(
          "SELECT category,SUM(input) i,SUM(output) o FROM mind_usage GROUP BY category",
        )
          .map((r) => `${r.category} ${r.i}/${r.o}`)
          .join("，") || 0,
        "按用途记账；embedding 的输入也在其中",
      );
  });

  section("relations", "与人和世界的联系", "五", (put) => {
    if (!has.has("mind_bond_events"))
      return put("关系变化", null, "没有 mind_bond_events");
    const rows = all(
      "SELECT origin,sources FROM mind_bond_events WHERE change!='interaction'",
    );
    const withSource = rows.filter((r) => refs(parse(r.sources)).length).length;
    put(
      "关系变化（不含普通来往）",
      rows.length,
      `有来源 ${share(withSource, rows.length) ?? 0}%`,
    );
    put(
      "按来源分",
      all(
        "SELECT origin,COUNT(*) n FROM mind_bond_events WHERE change!='interaction' GROUP BY origin",
      )
        .map((r) => `${r.origin} ${r.n}`)
        .join("，") || 0,
    );
  });

  section("correction", "反思与自我修正", "六", (put) => {
    if (has.has("mind_thoughts")) {
      const parents = new Map(
        all("SELECT id,parent_id FROM mind_thoughts").map((r) => [
          r.id,
          r.parent_id,
        ]),
      );
      let revisions = 0;
      let longest = 0;
      for (const [id, parent] of parents) {
        if (!parent) continue;
        revisions++;
        let length = 1;
        const seen = new Set([id]);
        for (
          let p = parent;
          p && parents.has(p) && !seen.has(p);
          p = parents.get(p)
        ) {
          seen.add(p);
          length++;
        }
        longest = Math.max(longest, length);
      }
      put("修正过的手记 / 最长修正链", `${revisions} / ${longest}`);
    }
    if (has.has("core_memories"))
      put(
        "记忆状态",
        all("SELECT status,COUNT(*) n FROM core_memories GROUP BY status")
          .map((r) => `${r.status} ${r.n}`)
          .join("，") || 0,
        "superseded 是被新事实取代的旧记忆，仍保留",
      );
  });

  section("boundaries", "自主边界", "七", (put) => {
    if (has.has("mind_revocations"))
      put(
        "撤销（墓碑）",
        all(
          "SELECT target_kind,COUNT(*) n FROM mind_revocations GROUP BY target_kind",
        )
          .map((r) => `${r.target_kind} ${r.n}`)
          .join("，") || 0,
      );
    if (has.has("mind_permission_events"))
      put(
        "记忆权限改动",
        get("SELECT COUNT(*) n FROM mind_permission_events").n,
      );
  });

  return { at, sections, problems };
}

function iso(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderAudit(result, { source = "" } = {}) {
  const lines = [
    "# 她的一生体检",
    "",
    `- 数据：${source || "（未注明）"}（只读打开，没有写入，没有调用模型）`,
    `- 生成时间：${iso(Date.now())}（本机时间）`,
    "",
    "## 需要注意",
    "",
    ...(result.problems.length
      ? result.problems.map((p) => `- ⚠ ${p}`)
      : ["- 没有发现底线问题。"]),
  ];
  for (const s of result.sections) {
    lines.push(
      "",
      `## ${s.title}${s.trait ? `（愿景特质 ${s.trait}）` : ""}`,
      "",
      "| 指标 | 数值 | 说明 |",
      "|---|---|---|",
    );
    for (const m of s.metrics)
      lines.push(
        `| ${m.label} | ${m.value ?? "—"} | ${String(m.note || "").replace(/\|/g, "｜")} |`,
      );
  }
  lines.push(
    "",
    "数值全部来自数据库里已经存下的记录；“—”表示这份数据里没有对应的表或数据。",
  );
  return lines.join("\n") + "\n";
}

const USAGE = `用法：
  npm run audit:life -- --db <备份文件.db> [--out <报告目录>] [--now <ISO 时间>]

  --db   要体检的数据库，建议用 npm run backup 生成的备份（data/backups/luckytri-*.db）
  --out  报告写到哪里，默认 data/reports
  --now  以哪个时间为“现在”，默认取数据库里最后一条记录的时间

只读打开数据库，不写入、不调用模型、不花 Token。`;

async function main(args) {
  const option = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  if (args.includes("--help") || args.includes("-h") || !option("--db")) {
    console.log(USAGE);
    return args.includes("--help") || args.includes("-h") ? 0 : 1;
  }
  const file = resolve(option("--db"));
  if (!existsSync(file)) {
    console.error(`找不到数据库文件：${file}`);
    return 1;
  }
  const now = option("--now") ? Date.parse(option("--now")) : undefined;
  const db = new DatabaseSync(file, { readOnly: true });
  let result;
  try {
    result = auditLife(db, { now });
  } finally {
    db.close();
  }
  const out = resolve(option("--out") || join("data", "reports"));
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const md = join(out, `life-audit-${stamp}.md`);
  writeFileSync(md, renderAudit(result, { source: file }));
  writeFileSync(
    join(out, `life-audit-${stamp}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(`体检完成：${md}`);
  console.log(
    result.problems.length
      ? result.problems.map((p) => `⚠ ${p}`).join("\n")
      : "没有发现底线问题。",
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  process.exitCode = await main(process.argv.slice(2));
