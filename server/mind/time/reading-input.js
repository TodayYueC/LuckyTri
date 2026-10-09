export function awaitsTextInput(words) {
  const value = String(words || "");
  if (
    /(?:已经|刚才|刚刚)(?:收到|拿到)|正文(?:已|已经)?(?:到手|收到了)/.test(
      value,
    )
  )
    return false;
  return /等(?:你|他|她|对方).{0,35}(?:发来|发过来|递来|递过来|提供)|等.{0,25}(?:稿子|稿件|正文|全文|资料|题目|要求).{0,18}(?:发|递|到|来|齐|提供)/.test(
    value,
  );
}

export function expectedTextTitle(task) {
  return (
    task.checkpoint?.expectedTextTitle ||
    String(task.title || "").match(/[《「]([^》」]+)[》」]/)?.[1] ||
    ""
  );
}

export function nextReadingChunk(mind, task, now) {
  const title = expectedTextTitle(task);
  const pending = task.checkpoint?.pendingStep?.chunk;
  if (pending) return !title || pending.title?.includes(title) ? pending : null;
  if (task.checkpoint?.awaitedText && !title) return null;
  return mind.reading.next(now, {
    title,
    after: task.checkpoint?.awaitedAfter || 0,
  });
}
