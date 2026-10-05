// English for the interface wording the server writes itself: labels, states,
// readiness steps, and the reasons shown in timelines. The Chinese text is the
// key, exactly as the code writes it. Only a whole string that equals a key is
// translated, so what she writes herself is never touched.
export const LABELS = {
  存在运行伴随文件: "Runtime sidecar files exist",
  近期自动恢复点: "Recent automatic restore point",
  // feedback.js
  挺自然: "Feels natural",
  太长了: "Too long",
  太端着: "Too stiff",
  梗太多: "Too many memes",

  // readiness.js
  "QQ 官方机器人凭据": "QQ official bot credentials",
  "在「系统 → 连接 QQ」填写机器人的 AppID 和 AppSecret":
    "Enter the bot's AppID and AppSecret under System → Connect QQ",
  "QQ 连接": "QQ connection",
  "已连接 QQ 开放平台；群里目前只收到 @ 她的消息，在开放平台开启「接收所有消息」后她才能看到整个群":
    "Connected to the QQ Open Platform. Groups only deliver messages that @ her for now; turn on “Receive all messages” on the platform so she can see the whole group.",
  "已连接 QQ 开放平台": "Connected to the QQ Open Platform",
  "正在连接 QQ 开放平台": "Connecting to the QQ Open Platform",
  填写凭据后自动连接: "Connects automatically once credentials are entered",
  "本机接入无需单独令牌，请确认接入端已登录并启用反向 WebSocket 客户端":
    "Local clients need no separate token. Check that the client is signed in and its reverse WebSocket client is enabled.",
  "OneBot 11 反向 WebSocket 已连接": "OneBot 11 reverse WebSocket connected",
  当前模型已测试: "Current model tested",
  "模型配置已变更，请重新测试": "The model settings changed. Test again.",
  "保存模型配置后，点击测试模型连接":
    "After saving the model settings, click Test model connection",
  开启真实回复: "Turn on real replies",
  "当前是模拟模式，不向 QQ 发言":
    "Simulation mode is on; nothing is said to QQ",
  总开关已关闭: "The master switch is off",
  真实模式与总开关已开启: "Real mode and the master switch are on",
  选择参与的会话: "Choose sessions to take part in",
  "到「对话」里开启一个群聊或私聊":
    "Turn on a group or private chat under Chats",

  // core/conversation-cues.js: parts of the day
  凌晨: "Small hours",
  早上: "Morning",
  中午: "Midday",
  下午: "Afternoon",
  晚上: "Evening",

  // core
  通过人格接口修改: "Changed through the persona API",
  "开不开口由 TA 自己决定，会话里不再设置概率、冷却、主动安慰或群人格；TA 在各群的样子见「人际」":
    "Whether to speak is TA's own decision; sessions no longer set probability, cooldown, proactive comfort, or a group persona. See People for how TA is in each group.",
  体验用户: "Trial user",
  模拟: "Simulated",
  未命名的群: "Unnamed group",
  未命名的人: "Unnamed person",
  "发送前配置或语境变化，取消剩余气泡":
    "Settings or context changed before sending; the remaining bubbles were cancelled",
  "这个会话还没有阶段性记忆总结。消息积累后会自动整理，也可以点击“立即整理”。":
    "This session has no memory summary yet. It is sorted automatically as messages build up, or click “Sort now”.",
  星空与时间: "Stars and time",
  未命名文档: "Untitled document",
  知识向量: "Knowledge vectors",
  自动备份完成: "Automatic backup finished",

  // mind/affect.js
  很开心: "Very happy",
  心情不错: "In a good mood",
  挺好: "Pretty good",
  安静: "Quiet",
  平静: "Calm",
  有点烦: "A bit annoyed",
  有点低落: "A little low",
  很烦躁: "Very irritable",
  不太好: "Not great",
  有精神: "Energetic",
  还行: "Okay",
  有点累: "A bit tired",
  很困: "Very sleepy",
  这阵子挺开心: "Quite happy lately",
  这阵子有点低落: "A bit low lately",

  // mind/anticipations.js
  答应的事: "Promises",
  想做的事: "Things she wants to do",
  别人的安排: "Others' plans",
  每年的日子: "Yearly days",
  "原事项已放下，重复整理不能恢复":
    "The original item was let go; sorting again cannot bring it back",
  今天: "today",
  明天: "tomorrow",
  后天: "the day after tomorrow",
  昨天: "yesterday",
  前天: "the day before yesterday",
  "作品完成，尚未交付": "Work finished, not yet delivered",
  正在做: "Doing it",
  "已有草稿，尚未完成": "A draft exists, not finished yet",
  还没做: "Not done yet",

  // mind/attention.js
  看到有人好像很难受: "Saw that someone seemed to be hurting",
  "睡着了，醒来再看": "Asleep; will look after waking",
  睡着了: "Asleep",
  有人在叫我: "Someone was calling me",
  "今天的话已经说得够多了，先只听":
    "I have said enough today; just listening for now",
  刚才还在聊: "Was just chatting",
  不久前说过话: "Spoke not long ago",
  有人在问大家: "Someone was asking everyone",
  聊到了我正在过的事: "The talk reached something I am living through",
  聊到了我在意的东西: "The talk reached something I care about",
  熟悉的人在说话: "Someone familiar was speaking",
  攒了不少消息: "Plenty of messages piled up",
  攒了一些消息: "Some messages piled up",
  有一阵没看群了: "Have not looked at the group for a while",
  上次的话碰到了我正在过的事:
    "What was said last time touched something I am living through",
  这是我在的地方: "This is a place I am in",
  看了一眼: "Took a look",
  "扫了一眼，群友在聊别的":
    "Glanced over; the group was talking about something else",

  // mind/bonds.js
  已经很熟悉这里: "Very familiar with this place",
  在这里待了一阵: "Been here a while",
  刚来这里不久: "Only just arrived here",
  有归属感: "Feels like she belongs",
  最近气氛有点紧: "The mood here has been a bit tense lately",
  好久没在这里说话了: "Have not spoken here for a long time",
  很熟: "Very familiar",
  认识一段时间了: "Known for a while",
  不太熟: "Not very familiar",
  几乎不认识: "Hardly knows them",
  很亲近: "Very close",
  挺亲近: "Fairly close",
  信任: "Trust",
  有点防备: "A little guarded",
  好久不见了: "Long time no see",
  最近没怎么说上话: "Have hardly spoken lately",
  还没怎么说过话: "Have hardly spoken yet",

  // mind/clock.js
  刚才: "just now",
  今天早些时候: "earlier today",
  好几天前: "several days ago",
  很久以前: "a long time ago",
  还未相遇: "Not met yet",
  "还没有真实聊天，时间暂时没有可以延续的落点。":
    "There is no real chat yet, so time has nothing to continue from.",
  仍在对话里: "Still in the conversation",
  "刚才的语气和话题仍然清晰，适合自然接着聊。":
    "The tone and topic from a moment ago are still clear; easy to carry on naturally.",
  留有余韵: "Lingering",
  "聊天刚安静下来，刚才没说完的事还会留在注意里。":
    "The chat has just gone quiet, and what was left unsaid stays in mind.",
  各自生活: "Each in their own life",
  "注意力已经离开即时对话，但重要的事仍可能被想起。":
    "Attention has left the live conversation, but important things may still come to mind.",
  安静了一阵: "Quiet for a while",
  "旧话题正在降温，未完成的事情比普通闲聊更容易被想起。":
    "The old topic is cooling; unfinished matters come to mind more easily than small talk.",
  偶尔想起: "Occasionally remembered",
  "相隔已有几天，熟悉感还在，但重新开口需要具体缘由。":
    "It has been a few days; the familiarity is still there, but speaking up again needs a concrete reason.",
  等待重逢: "Waiting to meet again",
  "已经隔了很久，旧事只保留为背景，新的消息会成为新的相遇。":
    "It has been a long time; old matters stay as background, and a new message becomes a new encounter.",

  // mind/day-planner.js
  自己决定先做这一段: "Decided to do this span first",
  "想具体做什么、几点开始和做多久":
    "Thinking through what to do, when to start and for how long",
  还缺少实际执行条件: "Still missing a real way to carry it out",
  这会儿想先歇着: "Wants to rest for now",

  // mind/days.js
  我来到这里: "I arrived here",

  // mind/life/diary.js
  "这一天有留在私下的事，原文不带到回顾里。":
    "Some of this day stayed private; the original text is not carried into the reflection.",
  今天没有写下什么: "Nothing was written today",
  写完了今天的日记: "Finished today's diary",
  没有需要整理的: "Nothing to sort",
  回顾这一段日子: "Look back over this stretch",
  这次没有写下回顾: "No reflection was written this time",
  回顾了这段日子: "Looked back over these days",
  "日记格式无效，未保存": "The diary format was invalid; not saved",
  "回顾格式无效，未保存": "The reflection format was invalid; not saved",

  // mind/life/presence.js
  此刻没有适合分享这个念头的地方:
    "No place suits sharing this thought right now",
  "念头已留下，等待合适的交流空隙":
    "The thought is kept; waiting for a good gap in conversation",
  "对话忙着，稍后重新看看":
    "The conversation is busy; she will look again later",
  "愿望保留，等待对话空隙":
    "The wish is kept; waiting for a gap in conversation",
  "调用失败，稍后重新决定": "The call failed; she will decide again later",
  "尚未发送，想说的话仍保留": "Not sent yet; what she wants to say is kept",
  此刻不想聊这件事: "Does not want to talk about this right now",
  没能联系: "Could not reach out",
  "调用未完成，稍后重新决定":
    "The call did not finish; she will decide again later",
  "调用未完成，想说的话仍保留":
    "The call did not finish; what she wants to say is kept",
  "主动联系的投递不确定，不再重试":
    "Delivery of the proactive message is uncertain; not retrying",

  // mind/life/index.js
  已有后台任务或服务已停止:
    "A background task is running or the service has stopped",
  正在推进自己的活动步骤: "Working through her own activity step",
  "先写日记或整理今天，保留续接位置":
    "Writing the diary or sorting today first; the place to resume is kept",
  "自己的活动在继续，普通交流可以伴随进行":
    "Her own activity continues; ordinary chat can go on alongside it",
  正在做自己的事: "Doing her own thing",
  独处未开启: "Time alone is off",
  今天用于独处的预算已经用完: "Today's budget for time alone is used up",
  尚未配置模型: "No model is configured yet",
  "没有正在参与、开启记忆的会话":
    "No session is taking part with memory turned on",
  还没有真实的经历: "No real experience yet",
  "还在聊天，等一个安静的空隙": "Still chatting; waiting for a quiet gap",
  对话处理中: "A conversation is being processed",
  距离上次独处太近: "Too soon after the last time alone",
  新经历还不多: "Not much new experience yet",
  "连着几次独处都没有新的理解，等新的经历":
    "Several times alone gave no new understanding; waiting for new experience",
  这次自己选择留下的打算: "An intention she chose to keep this time",
  放下了: "Let go",
  自己的活动步骤尚未结束: "Her own activity step has not finished",
  "正在做自己的事，保留专注时段": "Doing her own thing; the focus span is kept",
  "安静下来，重新看看最近的事": "Quiet now; looking over recent events again",
  没有新的理解: "No new understanding",
  "服务停止了，这次想法不作数":
    "The service stopped; this thought does not count",
  "天性改了，这次想法不作数": "Nature changed; this thought does not count",
  独处: "Alone",
  "想着想着又有了新对话；": "A new conversation began as she was thinking; ",
  留下了新的理解: "Left with a new understanding",
  "没有新想法，但心情有了变化": "No new thoughts, but her mood changed",
  独处时模型超时: "The model timed out during time alone",
  "独处输出格式无效，未保存":
    "The output format from time alone was invalid; not saved",
  有了新的理解: "Reached a new understanding",
  "安排调整：先写日记，保留续接位置":
    "Plan adjusted: write the diary first; the place to resume is kept",

  // mind/meetings.js
  对方: "The other person",
  有人: "Someone",
  "，那次没出声": ", and she stayed quiet that time",
  没出声: "said nothing",
  出了声: "spoke up",
  开口: "Spoke up",
  应了一下: "Gave a quick reply",
  说了不想聊: "Said she did not want to talk",

  // mind/memory.js
  这里: "here",
  私聊里: "in a private chat",
  别的群里: "in another group",

  // mind/nature.js
  醒着: "Awake",
  刚醒: "Just woke up",
  有点困了: "Getting sleepy",

  // mind/own-day.js
  独处回看有没有漏下约定:
    "Checking in her time alone whether any promise was missed",
  想想接下来愿意做点什么: "Thinking about what she would like to do next",
  把说过的约定重新理清了: "Sorted her promises out again",
  "回看过这一段，没有漏下的新约定":
    "Reviewed this stretch; no new promises were missed",
  这会儿想留一点空白: "Wants to leave some open time",
  想做的事情还缺少条件: "What she wants to do still lacks conditions",
  空下来时自己想做的事: "Something she wanted to do when free",
  给自己留下一件想做的事: "Left herself something to do",
  这件事已经有所安排: "This is already planned",

  // mind/self.js
  喜欢: "Likes",
  看法: "Views",
  特质: "Traits",
  习惯: "Habits",
  放在心上: "Keeping in mind",
  好奇: "Curiosity",

  // mind/thoughts.js
  后来想到: "Thought later",
  重新理解: "Understood anew",
  仍放在心上: "Still on her mind",
  久别想起: "Remembered after a long time",
  自己的念头: "Her own thought",
  在工作台里放下: "Let go from the console",

  // mind/time/activity-clock.js
  本段剧情与场景体验: "Experiencing this stretch of plot and scenes",
  "写作、推敲与收尾": "Writing, polishing and wrapping up",
  阅读与消化本段内容: "Reading and digesting this passage",
  思考与整理本段想法: "Thinking and sorting out these thoughts",
  本段活动: "This span's activity",
  本段: "this span",

  // mind/time/agenda.js
  "自己选择暂停，等待重新安排": "She chose to pause; waiting to be rescheduled",
  准备中: "Preparing",
  准备时段: "Preparation span",
  已发生: "Happened",
  "暂时停下来，进度已保存": "Paused for now; progress saved",
  "原安排已过去，等她重新选时间":
    "The original plan has passed; waiting for her to choose a new time",
  "事情已经记下，等她选择几点做、做多久":
    "Noted; waiting for her to choose when and for how long",
  安排在今天之外: "Planned for a day other than today",
  正在执行这份安排: "Carrying out this plan",
  管理台安排: "Set from the console",
  她选定的安排: "A plan she chose",
  这次投入: "Spent this time",
  作息中的睡眠时间: "Sleeping time in her daily rhythm",
  有主活动在继续: "A main activity continues",
  正在想自己的安排: "Thinking about her own plans",
  在睡觉: "Sleeping",
  这会儿还没有主活动: "No main activity right now",
  这会儿没有正在推进的主活动: "No main activity is in progress right now",
  普通交流可以伴随进行: "Ordinary chat can go on alongside",
  "把想做的事、开始时间和投入时长想清楚":
    "Think through what to do, when to start and how long to spend",
  醒来后再接着自己的安排: "Back to her own plans after waking",
  "下一项已经选好时间，之前可以聊天、歇着或随手折腾":
    "The next item has a time; until then she can chat, rest or tinker",
  "有活动保留了续接位置，之后由她重新安排":
    "An activity kept its place to resume; she will reschedule it later",
  "待办已经记下，等她选择具体时间":
    "The to-do is noted; waiting for her to choose a time",
  "可以自己找件小事做，也可以选择歇着":
    "She can find something small to do, or choose to rest",
  "下方是她已选定的开始时间和这次想投入的时长。实际经过单独记录；提前完成、暂停或优先级切换后会保留原安排并重新选择。空白不代表已经在做什么。":
    "Below are the start times she chose and how long she wants to spend. What actually happens is recorded separately; after finishing early, pausing or a priority switch, the original plan is kept and she chooses again. Blank space does not mean she is doing something.",

  // mind/time/api.js
  正在玩: "Playing",
  开发中: "In development",
  相关的人: "People involved",

  // mind/time/availability.js
  "除了她此刻真正能做的事，没有下单或实拍的执行能力，需要调整这条约定；仍未兑现":
    "Apart from what she can actually do right now, she cannot place orders or take real photos; this promise needs adjusting and is still unfulfilled",
  所需插件已停用: "The plugin this needs is switched off",
  来源已经撤销: "The source was undone",
  等待前一件事完成: "Waiting for the previous item to finish",
  书架这段内容已不可用: "This bookshelf passage is no longer available",
  实例已停止: "The instance stopped",
  自己的活动目前关闭: "Her own activity is off for now",
  来源会话目前未启用: "The source session is not enabled right now",
  "精力较低，先恢复一会儿再投入":
    "Energy is low; recovering a while before getting started",
  书架没有可读资料: "The bookshelf has nothing to read",

  // mind/time/commitment-review.js, delivery-links.js, executor.js
  独处回看时补回自己实际说出口的约定:
    "Filled in promises she actually spoke aloud while reviewing in her time alone",
  等待明确交付给谁: "Waiting to know who it is for",
  从实际说出口的话中补回约定: "Recovered a promise from what was actually said",
  "分享承诺归回已有作品，未新增创作待办":
    "The sharing promise was linked to an existing work; no new creative to-do was added",
  已归入已有作品的交付记录:
    "Filed under the delivery record of an existing work",
  "交付有真实作品与送达记录，归回原事项":
    "The delivery has a real work and a delivery record; returned to the original item",
  "先处理一件优先级更高的事，保留续接位置":
    "Handling a higher-priority item first; the place to resume is kept",
  更高优先级事项先做: "A higher-priority item goes first",
  这次还不想做: "Does not want to do it this time",
  接着做这一段: "Continuing this span",
  任务或服务状态已经变化: "The task or service state has changed",
  接着推敲与整理这一段: "Continuing to polish and sort this span",
  "草稿已保存，接着完成这一段": "Draft saved; continuing to finish this span",
  自己选择暂时放下这个项目: "She chose to set this project aside for now",

  // mind/time/experiences.js
  游玩: "Playing",
  创作: "Creating",
  阅读: "Reading",
  独处思考: "Thinking alone",
  探索: "Exploring",
  这次活动的记录: "Record of this activity",
  活动: "Activity",
  保存完成稿: "Saved the finished piece",

  // mind/time/games.js
  按这次安排接着体验这一小段:
    "Continuing to experience this short stretch as planned",
  建议生成期间状态发生变化:
    "The state changed while the suggestion was being made",
  等待她明确决定是否采纳整理建议:
    "Waiting for her to decide whether to take the suggestion",
  未得到明确选择: "No clear choice was made",
  自己选择不采纳: "She chose not to take it",
  她选择不采纳这个建议: "She chose not to take this suggestion",
  "已自行采纳，下一步检索本章资料":
    "She took it up herself; next she looks up material for this chapter",
  "需要明确游戏名称（例如《游戏名》）":
    "The game name must be clear (for example “Game Name”)",
  需要明确游戏名称: "The game name must be clear",
  内容与第一印象: "Content and first impressions",
  简介: "Introduction",
  资料返回时任务已经变化: "The task changed while the material was coming back",
  "没有新的可接触资料，进度保留": "No new material to look at; progress kept",
  资料不足: "Not enough material",
  没有目标章节资料: "No material for the target chapter",
  "模型知识整理，未经联网核验":
    "Organized from model knowledge, not verified online",
  联网检索资料: "Material from web search",
  "接着体验这一段剧情，留下自己的感受":
    "Continue this stretch of the story and leave her own feelings",
  "模型整理了资料，按实际内容安排接触时间":
    "The model organized the material; time is planned by its actual content",
  "检索到资料，按实际内容安排接触时间":
    "Material was found; time is planned by its actual content",
  接着玩这一段: "Keep playing this span",
  本段资料已不可用: "This span's material is no longer available",
  资料不可用: "Material unavailable",
  "只接触了这一小段，剩余内容已保留，不表示整份资料或整章结束":
    "Only this short stretch was covered; the rest is kept and it does not mean the whole material or chapter is done",
  本段实际接触的内容: "What was actually covered in this span",
  任务已经变化: "The task has changed",
  "资料不足以形成这一段体验，不能算整章完成":
    "Not enough material to form this experience; the chapter cannot count as done",
  选择下一段资料: "Choose the next passage of material",
  "玩过这一段，留下自己的感受": "Played this span and left her own feelings",
  游玩时留下的感受: "Feelings left while playing",
  自己决定暂时放下: "She decided to set it aside for now",
  保存本段游玩记录与进度: "Saved this span's play record and progress",

  // mind/time/index.js
  睡眠期间不推进自己的活动:
    "Her own activity does not advance while she sleeps",
  "运行间隔中断，未补算停机时间":
    "The run was interrupted; downtime was not made up",
  "专注段结束，歇一会再接着做":
    "The focus span ended; rest a moment, then continue",
  开始接着做: "Started continuing",
  "保存位置，下次接着做": "Place saved; continue next time",
  "写下了一部分，还没完成": "Part is written; not finished yet",
  "还没完成，得真正动笔写下来":
    "Not finished; it has to actually be written down",
  还没有完整交付: "Not fully delivered yet",
  在做自己的事: "Doing her own thing",
  整理想分享的话: "Sorting out what she wants to share",
  "回看自己的成果，挑想聊的内容":
    "Reviewing her results and picking what she wants to talk about",
  回看这一段: "Reviewing this span",
  整理成几句自己的话: "Putting it into a few sentences of her own",
  回看说过的话: "Reviewing what she said",
  想自己的安排: "Thinking about her own plans",
  整理有没有漏下的约定: "Sorting out whether any promise was missed",
  "一边做自己的事，一边交流": "Doing her own thing while chatting",
  先认真回应眼前的紧急情况:
    "Responding seriously to the urgent matter at hand first",
  自己选择换一下注意力: "She chose to shift her attention",
  留下了实际成果: "Left an actual result",
  实际活动已完成: "The actual activity is done",

  // mind/time/model-material.js, presentation.js, search.js
  用模型整理资料主题: "Sorting the material topic with the model",
  游玩体验: "Play experience",
  本段游玩记录: "This span's play record",
  "留下第一印象，想好接下来要做什么":
    "Leave first impressions and decide what to do next",
  继续游玩: "Keep playing",
  自己的游玩体验: "Her own play experience",
  "实例中断，查询结果未确认":
    "The instance was interrupted; the query result is unconfirmed",
  "资料查询条件已恢复，重新按优先级安排":
    "The conditions for the material query are back; rescheduled by priority",
  今日资料查询次数已用完: "Today's material query allowance is used up",
  请核对独立密钥与权限: "Check the separate key and its permissions",
  提供方限制了请求频率或账户额度:
    "The provider limited the request rate or account quota",
  请核对提供方与完整搜索地址: "Check the provider and the full search URL",
  请检查搜索服务与请求配置: "Check the search service and the request settings",
  "搜索返回格式与选定提供方不匹配，请核对提供方与完整搜索地址":
    "The search response format does not match the chosen provider. Check the provider and the full search URL.",
  "搜索连接超时，请检查网络、代理或增加超时":
    "The search connection timed out. Check the network and proxy, or raise the timeout.",
  "基于模型已有知识，具体剧情与章节仍需核验。":
    "Based on what the model already knows; specific plot and chapters still need verification.",

  // mind/time/sharing.js
  "实例中断，先核对送达情况":
    "The instance was interrupted; check delivery first",
  "暂缓，稍后再决定": "Postponed; she will decide later",
  "对方没有开启主动消息，等对方来找她":
    "They have proactive messages off; waiting for them to come to her",
  回看成果后整理的汇报已确认送达:
    "The report sorted out after reviewing the result was confirmed delivered",
  作品已全部确认交付: "The work was fully confirmed delivered",
  整理后的汇报已逐句送达:
    "The sorted report was delivered sentence by sentence",
  作品已完整确认交付: "The work was completely confirmed delivered",
  "送达状态不确定，需要核对": "Delivery is uncertain and needs checking",
  保存部分交付位置: "Saved where the partial delivery stopped",
  正在回看自己的成果: "Reviewing her own result",
  已整理成几句想说的话: "Sorted into a few sentences she wants to say",

  // mind/time/task-links.js
  "归回原事项，保留已完成或已放下的决定":
    "Returned to the original item; the finished or let-go decision is kept",
  "同一未完成事项补充来源，不新建待办":
    "Added a source to the same unfinished item; no new to-do",
  "重复事项已整理为一个执行计划；原约定未因此兑现":
    "Duplicates were folded into one execution plan; the original promise is not counted as fulfilled",
  "重复事项已合并，原记录保留":
    "Duplicates were merged; the original records are kept",
  "归入唯一事项，保留原文与时间":
    "Filed under a single item; the original text and time are kept",
  根据管理台明确请求重新整理并安排:
    "Re-sorted and scheduled at the console's explicit request",
  "合并重复来源，保留任务决定":
    "Merged duplicate sources; the task decision is kept",

  // mind/time/tasks.js
  低: "Low",
  普通: "Normal",
  高: "High",
  最高: "Highest",
  写作: "Writing",
  等待澄清: "Waiting for clarification",
  "事项已放下，不因重新整理来源而恢复":
    "The item was let go and is not restored by re-sorting sources",
  需要明确可以执行的内容: "A clear, actionable content is needed",
  留下一个可以接着做的安排: "Left a plan that can be continued",
  原约定已撤销: "The original promise was undone",
  "事项已放下，不自动重建待办":
    "The item was let go; the to-do is not rebuilt automatically",
  从自己留下的约定继续做: "Continuing from a promise she left herself",
  这是我实际说出口的打算: "This is an intention I actually said aloud",
  等待约定的条件澄清: "Waiting for the promise's conditions to be clarified",
  自己选定开始时间与投入时长: "She chose the start time and duration herself",
  调整优先级: "Adjusted the priority",
  这件事被放下了: "This was let go",

  // mind/time/works.js
  接着上一段往下写: "Continue writing from the previous part",
  保存一个完整小段: "Save a complete short passage",
  管理台提出的建议: "A suggestion from the console",
  "外部建议，等待她决定是否采纳":
    "An outside suggestion; waiting for her to decide whether to take it",

  // mind/view.js, schema.js, traits.js
  "（很久没想起了）": "(not thought of for a long time)",
  从旧人格迁移: "Migrated from the old persona",
  联网检索: "Web search",

  // studio/management.js
  测试连接: "Test connection",
  "连接超时，请检查 API 地址或网络":
    "The connection timed out. Check the API URL or the network.",
  "无法连接模型服务，请检查地址或网络":
    "Could not reach the model service. Check the address or the network.",
};

// Wording that carries a value. `{0}`, `{1}` are filled with what the code put
// in, and each value goes through the dictionaries again.
export const LABEL_PATTERNS = [
  ["定时备份整理调度失败：{0}", "Scheduling backup cleanup failed: {0}"],
  ["定时备份整理完成：{0} 份", "Scheduled backup cleanup finished: {0} copies"],
  ["定时备份整理失败：{0}", "Scheduled backup cleanup failed: {0}"],
  ["检查自动备份失败：{0}", "Checking the automatic backup failed: {0}"],
  ["退出码 {0}", "Exit code {0}"],
  ["自动备份失败：{0}", "The automatic backup failed: {0}"],
  ["后台维护失败：{0}", "Background maintenance failed: {0}"],
  ["自动备份调度失败：{0}", "Scheduling the automatic backup failed: {0}"],
  ["测试成功 · {0} ms", "Test passed · {0} ms"],
  ["{0} 个会话已开启", "{0} sessions turned on"],
  ["{0} 天后", "in {0} days"],
  ["{0} 天前", "{0} days ago"],
  ["{0} 周前", "{0} weeks ago"],
  ["{0} 个月前", "{0} months ago"],
  ["{0} 年前", "{0} years ago"],
  ["{0}满 {1} 年", "{0}: {1} years"],
  ["{0}的第 {1} 天", "{0}: day {1}"],
  ["认识{0}", "Met {0}"],
  ["写 {0} 的日记", "Write the diary for {0}"],
  ["写下了 {0} 的日记", "Wrote the diary for {0}"],
  ["夜里整理「{0}」里的事", "Sorting what happened in “{0}” at night"],
  ["夜里整理了「{0}」的 {1} 条消息", "Sorted {1} messages of “{0}” at night"],
  [
    "回顾了这段日子，翻开了第 {0} 章",
    "Looked back over these days and opened chapter {0}",
  ],
  [
    "回顾了这段日子，写下了第 {0} 章",
    "Looked back over these days and wrote chapter {0}",
  ],
  ["读了《{0}》，没多想", "Read “{0}” without thinking much of it"],
  ["读了《{0}》，留下了新的理解", "Read “{0}” and gained a new understanding"],
  ["想说：{0}", "Wants to say: {0}"],
  ["想说：{0}。{1}", "Wants to say: {0}. {1}"],
  [
    "被别人的话碰到过 {0} 次，后来那次{1}",
    "Touched by others' words {0} times; that later time she {1}",
  ],
  [
    "被别人的话碰到过 {0} 次，刚才那次{1}",
    "Touched by others' words {0} times; just now she {1}",
  ],
  [
    "被别人的话碰到过 {0} 次，上一次{1}，那次{2}",
    "Touched by others' words {0} times; last {1}, and she {2}",
  ],
  ["第 {0} / {1} 段", "Passage {0} / {1}"],
  ["主题片段 {0}", "Topic passage {0}"],
  [
    "正在玩，本段预计约 {0} 分钟",
    "Playing; this span should take about {0} min",
  ],
  [
    "我完成了《{0}》的第 {1} 篇，正文保存在作品库；其中情节和人物是创作。",
    "I finished piece {1} of “{0}”. The text is saved in the works library; the plot and characters in it are made up.",
  ],
  ["接续《{0}》第 {1} 篇", "Continue piece {1} of “{0}”"],
  [
    "玩过第 {0} 段，留下自己的游玩记录",
    "Played passage {0} and left her own play record",
  ],
  ["{0}，已保存 {1} 字完成稿", "{0}, saved a finished piece of {1} characters"],
  ["{0}，已保存 {1} 字正文", "{0}, saved {1} characters of text"],
  [
    "我玩了《{0}》的第 {1} 段，留下自己的游玩记录。",
    "I played passage {1} of “{0}” and left my own play record.",
  ],
  [
    "模型无法确认{0}资料；保留进度，等待补充资料",
    "The model could not confirm material for {0}; progress is kept, waiting for more material",
  ],
  [
    "只找到简介，没有{0}资料；保留原计划",
    "Only an introduction was found, with no material for {0}; the original plan is kept",
  ],
  ["做自己的{0}时的感受", "Feelings while doing her own {0}"],
  ["{0}，保存了《{1}》完成稿", "{0}, saved the finished piece of “{1}”"],
  ["{0}，保存了《{1}》草稿", "{0}, saved a draft of “{1}”"],
  ["扫了一眼（{0}），没细看", "Glanced over it ({0}); did not look closely"],
  ["{0}知道的", "learned {0}"],
];
