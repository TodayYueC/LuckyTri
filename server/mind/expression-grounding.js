export function claimsLivedAction(content) {
  return String(content || "")
    .split(/[。！？\n]/)
    .some(
      (clause) =>
        !/想|打算|准备|希望|假如|设想|如果/.test(clause) &&
        /(?:刚才|刚刚|今天|这次|然后|真的|已经)[^。！？]{0,25}(?:读了|读上|读完|翻开|翻出来|写完|完成了|打开了|开始读|动手了)/.test(
          clause,
        ),
    );
}

export function claimsSharedHistory(content) {
  return /(?:之前|上次|早些时候)[^。！？\n]{0,25}(?:他|她|对方|那个人|你)[^。！？\n]{0,20}(?:说过|聊过|看过|读过|回话|私下)|(?:他|她|对方|那个人|你)[^。！？\n]{0,15}(?:之前|上次|读过|看过|说过)/.test(
    String(content || ""),
  );
}

export const EXPRESSION_GROUNDING = `核对一个准备保存的自我念头是否把愿望写成行动，或把别人的话题误认成共同经历。只输出JSON。
candidate只是草稿，不是事实。notes/self是过去的想法、愿望或理解；它们可以支持新的感受和看法，不能单独证明这次真的开始、读完或做完。actions/currentLife是实际活动记录。sources只表示引用了哪里，不自动证明动作。按实际记录核对这次声称新做过的具体动作和对象；不能用无关作品或一条待办证明完成。声称共同经历时，还须核对实际参与者和各自说过的话；在别处读到另一人的讨论不证明当前对象参与过。自己的新想法、偏好、假设、打算可以没有执行记录，也不需要已采取外部行动。只指出确实无依据的新经历与归属，不评文风。
输出 {"ok":true或false,"reason":"具体哪项新经历有或没有实际记录"}。`;
