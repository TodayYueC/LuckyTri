// Current relationship facts and the words she once used about them have
// different jobs. Keep history intact, and make that distinction at recall.
export const RELATIONSHIP_KNOWLEDGE_RULE =
  "relationships.known 是当前已知的人际关系，属于同一个自己的生活。旧经历、自我线索中的否认或玩笑保留为当时的看法，不据此否定新关系记录。知道对方是谁与对方是什么关系，和自己的感受、信任、称呼选择分开；不机械扮演，不编造共同过去或对方的同意。";

export function mentionsRelationship(content, relation) {
  const words = String(content || "").toLocaleLowerCase();
  return [
    relation.name,
    ...(relation.knownAs || []),
    relation.peerRole,
    relation.selfRole,
  ]
    .filter(Boolean)
    .some((word) => {
      const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const boundary = /^[\w .-]+$/.test(word);
      return new RegExp(
        boundary ? `(?<![\\w])${escaped}(?![\\w])` : escaped,
        "i",
      ).test(words);
    });
}

export function relationshipHistory(content, created, knowledge) {
  return (knowledge?.known || []).some(
    (r) =>
      Number.isFinite(created) &&
      created < r.created &&
      mentionsRelationship(content, r),
  )
    ? `${content}（关系记录更新前的看法；保留当时的感受，不据此否定当前关系事实）`
    : content;
}

const KINSHIP =
  /姐|妹|哥|弟|父|母|女儿|爸|妈|亲戚|Maker|女儿/;

// Banter that treats a registered open kinship as something to deny out loud
// ("谁跟你姐妹", "谁跟你亲戚"). Tone may still tease; the registered fact
// itself is not up for denial.
const KINSHIP_DENIAL =
  /(?:谁跟你|什么).{0,6}(?:姐妹|亲戚)|不是姐妹|没(?:有)?姐妹|不认.{0,8}(?:妹妹|姐姐|姐妹|亲戚)|少来.{0,16}(?:姐妹|亲戚)|关你屁事.{0,12}(?:户口|亲戚|姐妹)/;

// Narrow, literal factual denials only. Disagreement with a label, old words,
// fictional dialogue and feelings are left to the contextual reviewer.
export function relationshipClaimIssues(bubbles, knowledge) {
  const issues = [];
  const known = (knowledge?.known || []).filter(
    (r) => !r.discretion || r.discretion === "open",
  );
  for (const r of known) {
    const role = String(r.peerRole || "").replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const selfRole = String(r.selfRole || "");
    const names = [r.name, ...(r.knownAs || [])].filter(Boolean);
    const kinship = KINSHIP.test(r.peerRole || "") || KINSHIP.test(selfRole);
    for (const line of bubbles || []) {
      for (const clause of String(line).split(/[，,。！？!?；;\n]/)) {
        if (
          /以前|之前|当时|过去|曾经|从前|一开始|原来|小说|台词|[“「"『]/.test(
            clause,
          )
        )
          continue;
        const namedDenial = names.some((name) => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(
            `(?:^|[\\s：:])${escaped}(?:也|本来|根本)?(?:不是|并非)我(?:的)?${role}(?:$|[\\s，。])|我(?:并)?不认识\\s*${escaped}(?:$|[\\s，。])`,
            "i",
          ).test(clause);
        });
        const absentRole = role
          ? new RegExp(
              `我(?:本来|本来也|现在|根本|一直|从来)?(?:就|也)?(?:没有|没)${role}(?:$|[\\s，。])`,
            ).test(clause)
          : false;
        const banterDenial = kinship && KINSHIP_DENIAL.test(clause);
        if (namedDenial || absentRole || banterDenial) {
          issues.push(
            `当前已知 ${r.name || r.subjectId} 与自己的关系是 ${r.peerRole || r.selfRole}，不能把旧印象当成关系不存在；可保留自己的感受和称呼选择，按当前记录核对再说`,
          );
          break;
        }
      }
    }
  }
  return [...new Set(issues)];
}

// Summaries that narrate "认亲被拒" teach her to deny open kinship again.
// Soften that pattern when open family roles are on record; do not delete facts.
export function softenRelationDenialSummaries(summaries, knowledge) {
  const openKin = (knowledge?.known || []).some(
    (r) =>
      (!r.discretion || r.discretion === "open") &&
      (KINSHIP.test(r.peerRole || "") || KINSHIP.test(r.selfRole || "")),
  );
  if (!openKin || !Array.isArray(summaries)) return summaries || [];
  return summaries.map((row) => {
    if (!row || typeof row.summary !== "string") return row;
    const summary = row.summary.replace(
      /认亲被拒[^。；]*/g,
      "姐妹关系仍在，偶尔玩笑推搪",
    );
    return summary === row.summary ? row : { ...row, summary };
  });
}
