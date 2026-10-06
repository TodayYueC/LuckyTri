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

// Narrow, literal factual denials only. Disagreement with a label, old words,
// fictional dialogue and feelings are left to the contextual reviewer.
export function relationshipClaimIssues(bubbles, knowledge) {
  const issues = [];
  for (const r of knowledge?.known || []) {
    const role = String(r.peerRole).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const names = [r.name, ...(r.knownAs || [])].filter(Boolean);
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
        const absentRole = new RegExp(
          `我(?:本来|本来也|现在|根本|一直|从来)?(?:就|也)?(?:没有|没)${role}(?:$|[\\s，。])`,
        ).test(clause);
        if (namedDenial || absentRole) {
          issues.push(
            `当前已知 ${r.name || r.subjectId} 与自己的关系是 ${r.peerRole}，不能把旧印象当成关系不存在；可保留自己的感受和称呼选择，按当前记录核对再说`,
          );
          break;
        }
      }
    }
  }
  return [...new Set(issues)];
}
