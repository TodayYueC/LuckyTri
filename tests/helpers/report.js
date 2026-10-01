export async function reviewReport(
  w,
  share,
  bubbles = ["我回看了一遍刚写的故事。", "最喜欢那扇门慢慢打开的地方。"],
) {
  w.answers.reflection = (data) =>
    data.passage ? { note: "故事的场景与她留下的感受。" } : { bubbles };
  let result;
  for (let step = 0; step < 100; step++) {
    result = await w.mind.time.sharing.send(w.life, share);
    if (result?.status !== "reviewing" && result?.status !== "reviewed")
      return result;
  }
  throw Error("汇报未能完成回看");
}
