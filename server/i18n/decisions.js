// English for the notes the server writes about what happened in a turn:
// why a reply was held back, why a delivery failed, what a step did. These are
// shown in the logs and the chat views. Prompts for the model and everything
// she says are not here; they stay as they are.
export const DECISIONS = {
  // channels
  引用恢复超时: "Recovering the quoted message timed out",
  "QQ 发送确认超时，不自动重发":
    "QQ did not confirm the send in time; not resending automatically",
  "QQ 没有完成这个请求": "QQ did not complete this request",
  "AppID 或 AppSecret 不正确": "The AppID or AppSecret is not correct",
  "主动消息太频繁，平台暂时限制了发送":
    "Proactive messages were too frequent; the platform paused sending for now",
  对方或这个群没有开启机器人的主动消息:
    "They or this group have not allowed proactive messages from the bot",
  机器人已不在这个群里: "The bot is no longer in this group",
  机器人在这个群里被禁言: "The bot is muted in this group",
  "消息太长，平台没有接收":
    "The message was too long; the platform did not accept it",
  平台不允许发送链接: "The platform does not allow sending links",
  消息内容没有通过平台审核: "The message did not pass the platform's review",
  "机器人已下线，请检查机器人状态": "The bot is offline. Check its status.",

  // context compaction
  没有需要压缩的内容: "Nothing needs compressing",
  "语境压缩失败，稍后自动重试":
    "Context compression failed; it will retry automatically",

  // orchestrator, delivery
  "有一个备用模型档案不存在，已跳过":
    "A backup model profile does not exist; skipped",
  "引用消息未能恢复，保留 unknown，不认领对象":
    "The quoted message could not be recovered; kept as unknown, no addressee claimed",
  "生成期间语境已更新，旧稿未发送":
    "The context changed while writing; the old draft was not sent",
  试聊的人: "Trial chat person",
  "话题来源或参与者已改变，这份旧稿未继续发送":
    "The topic's source or participants changed; this old draft was not sent",
  "新消息已进入下一批，取消旧稿":
    "New messages moved into the next batch; the old draft was cancelled",
  "模型回复格式异常，已使用本地短句兜底":
    "The model reply was malformed; a local short phrase was used instead",
  本地短句兜底: "Local short-phrase fallback",
  "这句话说出了别人要求保密的事，不能在这里说":
    "This line reveals something someone asked to keep secret and cannot be said here",
  "这句话把私下知道的事说出来了，不能在这里说":
    "This line reveals something known in private and cannot be said here",
  "回复复审结果格式异常，已按本地校验继续":
    "The reply review result was malformed; continued with the local check",
  "主动消息的语境核对结果无效，草稿保留":
    "The context check for the proactive message was invalid; the draft is kept",
  与天性或语境不一致: "Does not fit her nature or the context",
  "主动消息的事实与内容核对暂未完成，草稿保留，稍后重新决定":
    "The fact and content check for the proactive message is unfinished; the draft is kept and she will decide again later",
  "已发出的原话互相矛盾，先承认自己说乱了":
    "Her earlier words contradict each other; she admits she mixed them up",
  "本人旧话互相矛盾，使用核实后的简短更正":
    "Her own earlier words contradict each other; a short verified correction is used",
  "旧话错误且原回复对象明确，承认没有依据":
    "The earlier words were wrong and the original addressee is clear; she admits she had no basis",
  "旧话将第三人关系说错，使用核实后的简短更正":
    "The earlier words got a third person's relationship wrong; a short verified correction is used",
  "自己先开口的话没有他发来的消息可依，承认是猜的":
    "She spoke first and had no message from him to go on; she admits it was a guess",
  "先开口的话被追问依据，使用核实后的简短更正":
    "She was asked for the basis of what she said first; a short verified correction is used",
  "想说的话还没整理好，愿望保留，稍后重新决定":
    "What she wants to say is not sorted out yet; the wish is kept and she will decide again later",
  "没有人在叫她，回复两次仍未通过校验，不用空话顶替，不说了":
    "No one was calling her and the reply failed validation twice; no filler, she stays quiet",
  "没被叫到，话没整理好，就不说了":
    "Not called on and the words were not ready; she stays quiet",
  "回复两次生成仍未通过校验，使用本地安全短句":
    "The reply failed validation twice; a safe local short phrase is used",
  本地安全短句: "Safe local short phrase",
  "隔离回放完成，未发送或写入记忆":
    "Isolated replay finished; nothing was sent or written to memory",

  // reply validation
  气泡格式无效: "Bubble format is invalid",
  回复超过当前会话总字数:
    "The reply is over this session's total character limit",
  使用人格禁用表达: "Uses a phrase her persona rules out",
  重复近期回复: "Repeats a recent reply",
  气泡之间重复: "Bubbles repeat each other",
  客服式套话: "Customer-service boilerplate",
  "评价或攻击群友，过于刻薄": "Judges or attacks group members; too harsh",
  短句回复: "Short reply",

  // turn
  语境决策: "Context decision",
  会话已暂停或处于模拟模式: "The session is paused or in simulation mode",
  "图片使用已保存的观察，不再提交画面":
    "Using the saved image observation; the picture is not sent again",
  图片理解调用失败: "The image understanding call failed",
  "读房间的这几秒里，要回的人又说了话：先不花一次调用，并入下一批一起回":
    "While reading the room, the person she was answering spoke again; no call is spent now, it joins the next batch",
  "读房间时又有新话，并入下一批":
    "New words arrived while reading the room; joined to the next batch",
  "回合输出格式异常，按直接对话兜底":
    "The turn output was malformed; fell back to a direct reply",
  "主动判断没有整理好，愿望保留，稍后重新决定":
    "The proactive judgment was not sorted out; the wish is kept and she will decide again later",
  没能整理好想法: "Could not sort out her thoughts",
  没发出去: "Not sent",
  已移除不属于本轮消息的回复目标:
    "Removed a reply target that is not part of this round",
  "有人可能处在危机里，底线要求认真回应":
    "Someone may be in crisis; the baseline requires a serious reply",
  此刻的判断: "Judgment at this moment",

  // vision
  图片缓存不可用: "The image cache is unavailable",
  模型未开启视觉能力: "The model has vision turned off",
  图片地址不可用: "The image address is unavailable",
  超出本轮四张视觉预算: "Over this round's budget of four images",

  // initiative, growth, memory policy, own voice, origin
  会话不可用: "The session is unavailable",
  对方明确不想被主动联系: "They clearly do not want to be contacted first",
  "这段对话正在处理，稍后重新看看":
    "This conversation is being handled; she will look again later",
  "刚主动说过，愿望仍保留": "She just spoke first; the wish is still kept",
  还不需要重新看自己: "No need to look at herself again yet",
  独处预算已用完: "The budget for time alone is used up",
  新的相处还不多: "Not much new time together yet",
  回看自己在不同地方怎样长成:
    "Looking back at how she has grown in different places",
  还没有想改变的地方: "Nothing she wants to change yet",
  "天性、关系或服务状态已经变化":
    "Her nature, relationships or the service state have changed",
  "关系记录变了，按新认识重新整理，不提交旧想法":
    "Relationships changed; reconsider with the new knowledge instead of saving the old thought",
  把先前的自述整理成长期适用的自己:
    "Turning the earlier self-description into a lasting one",
  留下了有来源的新变化: "Left a new change that has a source",
  没有待整理经历: "No experiences waiting to be sorted",
  达到常规整理量: "Reached the usual amount to sort",
  重要经历已说完: "An important experience has been told",
  亲近的人留下了一段相处: "Someone close left a stretch of time together",
  少量经历已积压一段时间: "A few experiences have been waiting a while",
  低频会话的经历已等待一天:
    "Experiences from a quiet session have waited a day",
  等这段相处沉淀: "Waiting for this time together to settle",
  先听听自己想说什么: "First listening to what she wants to say",
  此刻没有想表达的新内容: "Nothing new to express right now",
  "状态已变化，这次想法未保存": "The state changed; this thought was not saved",
  "连着几条念头都只在接自己上一条，这一条也没接住新的东西，不留":
    "Several thoughts in a row only followed her previous one, and this one caught nothing new; not kept",
  "这个念头已经留过，不重复制造新的愿望":
    "This thought was already kept; no new wish is made from it",
  想把这个念头说出来: "Wants to say this thought aloud",
  "同一念头还在往前长，先留给自己，不换个地方重说":
    "The same thought is still growing; she keeps it to herself instead of repeating it elsewhere",
  留下一个自己想分享的念头: "Left a thought she wants to share",
  这句话先留给自己: "Keeping this line to herself for now",
  这位参与者: "This participant",
  "这份想法含有其他会话的私下来源，不能在这里继续":
    "This thought has a private source from another session and cannot continue here",
  "话题来源缺失、已撤销或过长，参与者尚未核实":
    "The topic's source is missing, undone or too long, and the participants are not verified",
  主动交流对象不明确: "It is unclear who the proactive message is for",

  // simulation
  "模拟：对方收口，留白": "Simulated: the other person wrapped up; leave it",
  "模拟：避免复读": "Simulated: avoid repeating",

  // stored wait reasons
  "实例中断，进度已保留": "The instance was interrupted; progress kept",
  等待独立搜索密钥: "Waiting for the separate search key",
  独立搜索尚未启用: "Separate search is not enabled yet",
  共享知识库: "Shared knowledge base",
};

export const DECISION_PATTERNS = [
  ["整理了 {0} 段语境摘要", "Sorted {0} context summaries"],
  ["QQ 用户·{0}", "QQ user·{0}"],
  ["读取 QQ {0} 失败：{1}", "Reading QQ {0} failed: {1}"],
  ["读取群 {0} 的名字失败：{1}", "Reading the name of group {0} failed: {1}"],
  [
    "模型服务暂时不可用，{0} 秒后再试（第 {1} 次）",
    "The model service is unavailable for now; trying again in {0} seconds (attempt {1})",
  ],
  [
    "回复复审暂不可用，已按本地校验继续：{0}",
    "The reply review is unavailable; continued with the local check: {0}",
  ],
  ["分享选择未执行：{0}", "The sharing choice was not carried out: {0}"],
  [
    "图片理解失败，本轮不根据画面编造：{0}",
    "Image understanding failed; she will not invent the picture this round: {0}",
  ],
  ["每分钟发言轮数限速（{0}轮）", "Per-minute turn limit ({0} turns)"],
  [
    "自我描述整理未完成：{0}",
    "Sorting the self-description did not finish: {0}",
  ],
  [
    "自我描述重写未完成：{0}",
    "Rewriting the self-description did not finish: {0}",
  ],
  [
    "连着 {0} 条念头都只在接自己上一条，还没有新的东西可接",
    "{0} thoughts in a row only followed her previous one; nothing new to pick up yet",
  ],
  ["模拟样例 · {0}", "Simulated sample · {0}"],
  ["上次见到是 {0}", "Last seen {0}"],
  ["上次说上话是 {0}", "Last spoke {0}"],
];
