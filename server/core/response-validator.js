import { conversationalIssues, replyFocus } from "./conversation-cues.js";
import { gentlePersona } from "./persona-manager.js";
import { initiativeContext } from "./initiative-context.js";
import { interestTerms } from "../mind/attention.js";
const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function contradictoryOwnWords(snapshot, decision = {}) {
  const targets = (snapshot.messages || []).filter((message) =>
    decision.targetMessageIds?.includes(message.id),
  );
  const words = (snapshot.inner?.continuity?.people || [])
    .filter((person) =>
      targets.some((message) => String(message.speaker) === String(person.id)),
    )
    .flatMap((person) =>
      (person.myElsewhereWords || []).map((line) => line.text || ""),
    );
  return (
    words.some((line) => /不是|没说|并非|不指/.test(line)) &&
    words.some((line) => /就是|确实|说的就是|指的就是/.test(line))
  );
}
// The reviewer judges one reply; it needs the turn and its recent lead-in,
// not the summaries, recall or the rest of the transcript.
export function reviewContext(snapshot, decision = {}) {
  if (snapshot.initiative) return initiativeContext(snapshot);
  const {
    persona: _persona,
    sourceRows: _sourceRows,
    batch: _batch,
    summaries: _summaries,
    summaryInstruction: _summaryInstruction,
    stages: _stages,
    recalled: _recalled,
    budget: _budget,
    historyStart: _historyStart,
    self: _self,
    inner: _inner,
    ...rest
  } = snapshot;
  const messages = snapshot.messages || [];
  const focus = new Set([
    ...(snapshot.batchIds || []),
    ...(decision.targetMessageIds || []),
    ...(decision.evidenceIds || []),
  ]);
  for (const m of messages)
    if (focus.has(m.id)) for (const id of m.replyChain || []) focus.add(id);
  const recent = new Set(messages.slice(-30).map((m) => m.id));
  return {
    ...rest,
    ...(snapshot.inner?.continuity
      ? { continuity: snapshot.inner.continuity }
      : {}),
    messages: messages.filter((m) => focus.has(m.id) || recent.has(m.id)),
  };
}
const bubbleLimit = (decision) =>
  decision.maxBubbles ?? (decision.action === "MULTI_MESSAGE" ? 3 : 2);
export function normalizeResponse(result, decision, fallback = "嗯") {
  const maxBubbles = bubbleLimit(decision);
  let bubbles = [];
  if (Array.isArray(result?.bubbles)) bubbles = result.bubbles;
  else if (typeof result?.bubbles === "string") bubbles = [result.bubbles];
  else
    for (const key of ["reply", "text", "content"])
      if (typeof result?.[key] === "string" && result[key].trim()) {
        bubbles = [result[key]];
        break;
      }
  bubbles = bubbles
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maxBubbles);
  if (!bubbles.length) bubbles = [fallback];
  return {
    ...(result && typeof result === "object" ? result : {}),
    bubbles,
    reason:
      typeof result?.reason === "string" && result.reason.trim()
        ? result.reason
        : "短句回复",
  };
}
export function validateResponse(result, snapshot, decision, maxChars = 180) {
  const issues = [];
  const maxBubbles = bubbleLimit(decision);
  if (
    !Array.isArray(result.bubbles) ||
    result.bubbles.length < 1 ||
    result.bubbles.length > maxBubbles ||
    result.bubbles.some((x) => typeof x !== "string" || !x.trim())
  )
    return ["气泡格式无效"];
  if (result.bubbles.reduce((n, s) => n + Array.from(s).length, 0) > maxChars)
    issues.push("回复超过当前会话总字数");
  if (decision.choice === "react" && Array.from(result.bubbles[0]).length > 8)
    issues.push("选择了简短反应，只写一个极短的反应");
  const recent = snapshot.messages
    .filter((m) => m.role === "assistant")
    .slice(-12)
    .map((m) => m.text);
  const continuity = snapshot.inner?.continuity;
  const sharedElsewhere =
    continuity?.requested &&
    continuity.people.some((person) =>
      person.places.some((place) => !place.current),
    );
  const pledgedTo = new Set(
    (continuity?.people || [])
      .filter(
        (person) =>
          person.myPrivateIntentions?.length ||
          person.recentShared?.some(
            (line) =>
              line.role === "assistant" &&
              /答应|说好|下次|以后|我会|我就|记住/.test(line.text),
          ) ||
          person.sharedMoments?.some(
            (moment) =>
              moment.privateOrigin &&
              moment.iSaid?.some((line) =>
                /答应|说好|下次|以后|我会|我就|记住/.test(line),
              ),
          ),
      )
      .map((person) => String(person.id)),
  );
  const targetMessages = snapshot.messages.filter((m) =>
    decision.targetMessageIds?.includes(m.id),
  );
  const pledgedTurn = targetMessages.some((m) =>
    pledgedTo.has(String(m.speaker)),
  );
  const affectionTurn = targetMessages.some(
    (m) =>
      (m.relation === "direct" ||
        /(?:^|:)private:/.test(snapshot.sessionId || "")) &&
      /(?:想你|喜欢你|爱你)/.test(m.text || ""),
  );
  const privateLines = (continuity?.people || []).flatMap((person) => [
    ...(person.recentShared || []).map((line) => line.text),
    ...(person.myPrivateIntentions || []).map((line) => line.content),
    ...(person.myElsewhereWords || [])
      .filter((line) => line.privateOrigin)
      .map((line) => line.text),
    ...(person.sharedMoments || [])
      .filter((moment) => moment.privateOrigin)
      .flatMap((moment) => [
        ...(moment.theySaid || []).map((line) => line.text),
        ...(moment.iSaid || []),
      ]),
  ]);
  const ownWordsConflict = contradictoryOwnWords(snapshot, decision);
  if (
    ownWordsConflict &&
    !/前后|说乱|不一致|矛盾|改口|两种说法|先.{0,24}后/.test(
      result.bubbles.join(" "),
    )
  )
    issues.push(
      "本人对同一件事留下相反说法，这次必须承认前后不一致，不能只挑一条旧话解释",
    );
  const publicWords = norm(
    snapshot.messages
      .filter((message) => message.role === "user")
      .slice(-12)
      .map((message) => message.text || "")
      .join(""),
  );
  for (const text of result.bubbles) {
    const spoken = norm(text);
    if (
      ownWordsConflict &&
      /从头到尾|始终|一直|只指|唯一|没在别处乱/.test(text)
    )
      issues.push(
        "本人在别处对同一称呼或关系有相反说法，不能声称从头到尾一致；承认前后说乱了",
      );
    if (
      privateLines.some((line) => {
        const privateWords = norm(line || "");
        for (let i = 0; i + 12 <= privateWords.length; i += 3) {
          const phrase = privateWords.slice(i, i + 12);
          if (spoken.includes(phrase) && !publicWords.includes(phrase))
            return true;
        }
        return false;
      })
    )
      issues.push("这句话照搬了只在私下说过的原话，不能在群里公开复述");
    if (
      pledgedTurn &&
      /(?:没|没有|不记得|从未).{0,8}(?:答应|承诺|说过)|(?:答应|承诺).{0,8}(?:没有|不存在)|(?:有|拿出).{0,4}证据|你记错了/.test(
        text,
      )
    )
      issues.push(
        "已有核实的本人承诺；不能否认、反问证据或把失约推给对方，简短承认并回应当下",
      );
    if (
      targetMessages.some((m) =>
        (continuity?.people || []).some(
          (person) =>
            String(person.id) === String(m.speaker) &&
            person.myElsewhereWords?.length,
        ),
      ) &&
      /(?:我)?(?:没|没有|从未|从来没|不记得).{0,10}(?:说过|说|喊过|喊|叫过|叫)/.test(
        text,
      )
    )
      issues.push(
        "别处已有本人真实发出的相关原话，不能否认自己说过；先核对当时对象再修正",
      );
    if (
      affectionTurn &&
      /(?:才见过|刚见过|不是才见|别摸鱼摸到我|上班别摸鱼)/.test(text)
    )
      issues.push(
        "对方在直接表达想念；不要用见面时间或摸鱼玩笑驳回这份表达，按当下关系自然回应",
      );
    if (
      sharedElsewhere &&
      /(?:不能|不算|不能因此).{0,24}(?:共同经历|共同相处)|(?:从来|从没|完全).{0,8}(?:没聊过|不记得|没相处过|没有共同经历)|(?:没在|没有在).{0,8}(?:别的|其他|其它).{0,8}群.{0,8}(?:聊|相处)|只有.{0,8}(?:这段|这次)私聊.{0,8}(?:经历|记录)/.test(
        text,
      )
    )
      issues.push(
        "已核实和同一个人在其他地方真正说过话，换到私聊不会抹掉共同经历；依据 continuity 中具体的旧事回应，不把公开相处说成别的实例或不能算共同经历",
      );
    if (
      snapshot.initiative &&
      /(?:收到|看到|看见)你(?:们)?(?:刚刚?|刚才|又|发来|来找我)|你(?:们)?(?:刚刚?|刚才|这会儿).{0,8}(?:说|问|发|提|找我)|(?:刚刚?|刚才|这会儿)你(?:们)?.{0,8}(?:说|问|发|提|找我)|你(?:又来|来找我|发来(?:了)?消息)/.test(
        text,
      )
    )
      issues.push(
        "本轮没有收到新消息，不能捏造对方刚说过、发过消息或来找你；若确实回忆旧事要用过去的时间",
      );
    if ((snapshot.persona?.forbidden || []).some((w) => w && text.includes(w)))
      issues.push("使用人格禁用表达");
    if (
      /[hH]{2,}[。！!～~]*$/.test(text) &&
      norm(text).length > 6 &&
      recent
        .slice(-5)
        .filter((r) => norm(r).length > 6 && /[hH]{2,}[。！!～~]*$/.test(r))
        .length >= 2
    )
      issues.push("不要把hh反复当句尾装饰；删掉装饰，保留具体回应");
    const briefReaction =
      /^(?:h{2,6}|哈{1,6}|嗯{1,3}|好|行|哦{1,3}|啊|对|是的|晚安)$/i.test(
        norm(text),
      );
    if (!briefReaction && recent.some((r) => norm(r) === norm(text)))
      issues.push("重复近期回复");
    if (
      gentlePersona(snapshot.persona) &&
      /你们?[^。！？]{0,10}(?:出糗|怎么这么|脑子|太菜|有病)|我怎么知道|现在又嫌我|你倒是|累傻了|甩锅|难伺候|你除了.*还会啥|你倒是说|被我说中了|活该|自找的|赚了个教训/.test(
        text,
      )
    )
      issues.push("低毒舌人格不质问、挖苦或揣测群友恶意");
    if (/又一张表情包|怎么连续几张|都不带字的|你们.*刷屏/.test(text))
      issues.push("不要把发图行为本身当话题点评");
    if (
      /你们是复读机|你真蠢|你(?:们)?(?:就是|真是|是个)?(?:弱智|废物)/.test(text)
    )
      issues.push("评价或攻击群友，过于刻薄");
    if (
      /我理解你的感受|作为一个AI|我只是(?:一个|个)?(?:AI|助手)|有什么需要帮助|你并不孤单|(?:骂吧|慢慢说|你继续)[，,。\s]*我听着/.test(
        text,
      )
    )
      issues.push("客服式套话");
    for (const phrase of ["笑死", "我服了", "不是哥们", "你们怎么回事", "经典"])
      if (
        text.includes(phrase) &&
        recent.filter((r) => r.includes(phrase)).length >= 2
      )
        issues.push(`近期反复使用“${phrase}”`);
  }
  if (new Set(result.bubbles.map(norm)).size !== result.bubbles.length)
    issues.push("气泡之间重复");
  const plans = (snapshot.inner?.expecting || [])
    .map((line) => String(line).match(/计划：(.+?)（/)?.[1])
    .filter(Boolean);
  const current = targetMessages.map((m) => m.text || "").join(" ");
  if (
    plans.length &&
    !/(?:已经|刚刚?|刚才).{0,12}(?:去|做|完成|回来)|(?:去过|做完|结束了)/.test(
      current,
    ) &&
    result.bubbles.some((line) => {
      if (!/(?:你|他|她).{0,12}(?:不是|已经).{0,18}(?:了|完|回来)/.test(line))
        return false;
      const said = interestTerms([line]);
      return plans.some(
        (plan) =>
          [...interestTerms([plan])].filter((term) => said.has(term)).length >=
          2,
      );
    })
  )
    issues.push(
      "这件事只记录为对方的安排，尚未确认已经发生；不要用‘你不是已经……了吗’当成事实",
    );
  const focus = replyFocus(snapshot, decision);
  const questioned = targetMessages.at(-1);
  if (focus.kind === "clarify_claim" && questioned) {
    const cue = interestTerms([questioned.text || ""]);
    const earlierToSomeoneElse = (snapshot.messages || []).filter(
      (message) =>
        message.role === "assistant" &&
        message.id < questioned.id &&
        (message.replyTargets || []).length &&
        (message.replyTargets || []).every(
          (target) => String(target.speaker) !== String(questioned.speaker),
        ) &&
        [...interestTerms([message.text || ""])].some((term) => cue.has(term)),
    );
    if (
      earlierToSomeoneElse.length &&
      result.bubbles.some((line) =>
        /从头到尾.{0,16}(?:你|都是)|一直.{0,12}(?:你|只)|你自己.{0,8}(?:听岔|记错)/.test(
          line,
        ),
      )
    )
      issues.push(
        "相关旧话有明确的另一位回复对象，不能说从头到尾只对眼前人说或责怪对方听错",
      );
    if (
      /主人/.test(questioned.text || "") &&
      earlierToSomeoneElse.some((message) =>
        /你主人|他的主人/.test(message.text || ""),
      )
    ) {
      const line = result.bubbles.join(" ");
      if (
        /指的就是.{0,10}你|说的就是.{0,10}你|你.{0,8}是.{0,8}(?:他|别人).{0,4}主人|(?:他|别人).{0,4}主人.{0,6}是你/.test(
          line,
        )
      )
        issues.push(
          "旧话是对第三人说的，但没有证据证明眼前人是第三人的主人；承认当时说错，不能继续补造归属",
        );
      if (/你.{0,8}(?:对号入座|误会|听岔|理解错)/.test(line))
        issues.push("自己把无依据的人际关系说出口，不能让追问者承担误解责任");
      const claimedEarlierQuestion =
        /(?:是|因为|顺着).{0,20}(?:问我|问的是).{0,12}(?:养我|谁.{0,2}养|主人)/.test(
          line,
        );
      if (claimedEarlierQuestion) {
        const targets = new Set(
          earlierToSomeoneElse.flatMap((message) =>
            (message.replyTargets || []).map((target) => target.messageId),
          ),
        );
        const actuallyAsked = (snapshot.messages || []).some(
          (message) =>
            targets.has(message.id) &&
            /养你|养我|主人/.test(message.text || ""),
        );
        if (!actuallyAsked)
          issues.push(
            "对方是在旧话之后才追问主人，不能倒置时间说那句旧话是在回答这个问题",
          );
      }
    }
  }
  if (
    ["repair", "acknowledge", "promise_check", "clarify_claim"].includes(
      focus.kind,
    ) &&
    result.bubbles.length > 1
  )
    issues.push("这一轮只是纠正或确认，一句收住，不要追加原话题或解释");
  if (focus.kind === "acknowledge" && result.bubbles.join("").length > 12)
    issues.push("对方只确认了一下，不需要再评论或劝慰，用很短的回应收住");
  if (
    focus.kind === "acknowledge" &&
    result.bubbles.some((line) =>
      /你(?:自己|刚才|之前|前面).{0,6}(?:说|提)|你明明/.test(line),
    )
  )
    issues.push(
      "对方只是确认，不要突然把别处的话题和未经核实的说法安到对方头上",
    );
  issues.push(...conversationalIssues(result, snapshot, decision));
  return [...new Set(issues)];
}
