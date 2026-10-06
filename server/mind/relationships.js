import { randomUUID } from "node:crypto";
import { parseSessionKey } from "../channels/session-key.js";
import { hasCredential, text } from "./util.js";
import { normalized } from "./util.js";
import { leaks } from "./guard.js";

export const RELATIONSHIP_ROLES = [
  "妹妹",
  "姐姐",
  "弟弟",
  "哥哥",
  "朋友",
  "伙伴",
];
const FAMILY = new Set(RELATIONSHIP_ROLES.slice(0, 4));
const scope = (room) => {
  try {
    return room ? parseSessionKey(room) : null;
  } catch {
    return null;
  }
};

// Account identity and an explicit arrangement, never invented encounters or
// earned trust. Changes append history; nickname equality does not bind peers.
export class Relationships {
  constructor(mind) {
    this.mind = mind;
    this.db = mind.db;
  }
  version() {
    return this.db
      .prepare("SELECT COALESCE(MAX(rowid),0) n FROM mind_relationships")
      .get().n;
  }
  current(subject, { now = Date.now(), room = "" } = {}) {
    const place = scope(room);
    const row = this.db
      .prepare(
        "SELECT * FROM mind_relationships WHERE subject_id=? AND created<=? ORDER BY created DESC,rowid DESC",
      )
      .all(String(subject), now)
      .find(
        (r) =>
          !place ||
          (r.channel === place.channel &&
            (r.account_id === "_" || r.account_id === place.accountId)),
      );
    return row?.status === "active" ? row : null;
  }
  visible(row, room) {
    if (!row || !room || row.discretion === "open") return !!row;
    const place = scope(room);
    return (
      place?.kind === "private" &&
      place.nativeId === row.subject_id &&
      place.channel === row.channel &&
      (row.account_id === "_" || place.accountId === row.account_id)
    );
  }
  discloses(bubbles, room, now = Date.now()) {
    const hidden = this.list(now).filter((row) => !this.visible(row, room));
    if (
      leaks(
        bubbles,
        hidden.filter((r) => r.note).map((r) => ({ content: r.note })),
      ).length
    )
      return true;
    const said = normalized(bubbles.join(" "));
    const english = {
      妹妹: "youngersister",
      姐姐: "oldersister",
      弟弟: "youngerbrother",
      哥哥: "olderbrother",
      朋友: "friend",
      伙伴: "companion",
    };
    return hidden.some((row) => {
      const names = [
        row.name,
        this.mind.bonds.name(row.subject_id),
        row.subject_id,
      ]
        .filter(Boolean)
        .map(normalized);
      const role = normalized(row.peer_role),
        en = english[row.peer_role] || role;
      return names.some((name) =>
        [
          "我的" + role + name,
          "我" + role + name,
          name + "是我的" + role,
          name + "是我" + role,
          name + role,
          "my" + en + name,
          name + "ismy" + en,
        ].some((line) => said.includes(line)),
      );
    });
  }
  weight(row) {
    return row ? (FAMILY.has(row.peer_role) ? 0.15 : 0.05) : 0;
  }
  view(row, room = "") {
    if (!this.visible(row, room)) return null;
    return {
      id: row.id,
      subjectId: row.subject_id,
      channel: row.channel,
      accountId: row.account_id,
      kind: row.kind,
      name: row.name,
      peerRole: row.peer_role,
      selfRole: row.self_role,
      discretion: row.discretion,
      note: row.note,
      created: row.created,
      origin: "owner",
    };
  }
  list(now = Date.now()) {
    const seen = new Set();
    return this.db
      .prepare(
        "SELECT * FROM mind_relationships WHERE created<=? ORDER BY created DESC,rowid DESC",
      )
      .all(now)
      .filter((r) => {
        const key = JSON.stringify([r.subject_id, r.channel, r.account_id]);
        if (seen.has(key)) return false;
        seen.add(key);
        return r.status === "active";
      });
  }
  history(subject, limit = 30) {
    return this.db
      .prepare(
        "SELECT * FROM mind_relationships WHERE subject_id=? ORDER BY created DESC,rowid DESC LIMIT ?",
      )
      .all(String(subject), limit);
  }
  save(input, now = Date.now()) {
    const subject = text(input?.subjectId, 128),
      channel = String(input?.channel || "onebot"),
      account = text(input?.accountId || "_", 128);
    if (
      String(input?.subjectId || "").length > 128 ||
      String(input?.accountId || "").length > 128 ||
      !/^[\w.-]{1,128}$/.test(subject) ||
      ["bot", "self", "_"].includes(subject) ||
      !["onebot", "qqbot"].includes(channel) ||
      !/^[\w.-]{1,128}$/.test(account) ||
      (channel === "onebot" && !/^\d+$/.test(subject))
    )
      throw Error("关系对象账号无效");
    if (channel === "qqbot" && account === "_")
      throw Error("官方机器人关系需要指定应用账号");
    if (
      this.db
        .prepare("SELECT 1 FROM core_events WHERE account_id=? LIMIT 1")
        .get(subject)
    )
      throw Error("不能把当前实例绑定为自己的关系对象");
    const kind = String(input.kind || "human"),
      role = text(input.peerRole, 24),
      name = text(input.name, 40),
      note = text(input.note, 300),
      discretion = input.discretion || "open";
    if (
      !["human", "bot"].includes(kind) ||
      !role ||
      String(input.peerRole).length > 24 ||
      String(input.name || "").length > 40 ||
      String(input.note || "").length > 300 ||
      !["open", "private", "secret"].includes(discretion)
    )
      throw Error("关系设置无效");
    const gender = this.mind.nature.current(now).gender;
    const older =
      gender === "female" ? "姐姐" : gender === "male" ? "哥哥" : "年长手足";
    const younger =
      gender === "female" ? "妹妹" : gender === "male" ? "弟弟" : "年幼手足";
    const opposite = {
      妹妹: older,
      弟弟: older,
      姐姐: younger,
      哥哥: younger,
      朋友: "朋友",
      伙伴: "伙伴",
    };
    const selfRole = text(input.selfRole || opposite[role] || "", 24);
    if (
      !selfRole ||
      String(input.selfRole || "").length > 24 ||
      hasCredential([role, selfRole, name, note].join(" "))
    )
      throw Error("关系称呼或备注无效");
    const room = `${channel}:${account}:private:${subject}`,
      previous = this.current(subject, { now, room });
    if (
      input.expectedId !== undefined &&
      input.expectedId !== (previous?.id || null)
    )
      throw Error("关系已经变化，请刷新后再修改");
    if (
      previous &&
      previous.kind === kind &&
      previous.peer_role === role &&
      previous.self_role === selfRole &&
      previous.name === name &&
      previous.note === note &&
      previous.discretion === discretion
    )
      return this.view(previous);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO mind_relationships(id,created,subject_id,channel,account_id,kind,name,peer_role,self_role,discretion,note,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active')",
        )
        .run(
          randomUUID(),
          now,
          subject,
          channel,
          account,
          kind,
          name,
          role,
          selfRole,
          discretion,
          note,
        );
      this.db
        .prepare(
          "INSERT INTO mind_people(user_id,name,first_seen,last_seen,sessions) VALUES (?,NULL,NULL,NULL,'[]') ON CONFLICT(user_id) DO NOTHING",
        )
        .run(subject);
      this.db.exec("COMMIT");
      this.mind.repo.store.revision++;
      return this.view(this.current(subject, { now, room }));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  end(subject, input = {}, now = Date.now()) {
    if (
      String(input.note || "").length > 300 ||
      hasCredential(String(input.note || ""))
    )
      throw Error("关系称呼或备注无效");
    const room = `${input.channel || "onebot"}:${input.accountId || "_"}:private:${subject}`,
      row = this.current(subject, { now, room });
    if (!row) throw Error("关系不存在或已解除");
    if (input.expectedId !== undefined && input.expectedId !== row.id)
      throw Error("关系已经变化，请刷新后再修改");
    this.db
      .prepare(
        "INSERT INTO mind_relationships(id,created,subject_id,channel,account_id,kind,name,peer_role,self_role,discretion,note,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'ended')",
      )
      .run(
        randomUUID(),
        now,
        row.subject_id,
        row.channel,
        row.account_id,
        row.kind,
        row.name,
        row.peer_role,
        row.self_role,
        row.discretion,
        text(input.note || "在管理台解除关系", 300),
      );
    this.mind.repo.store.revision++;
    return { ended: true };
  }
}
