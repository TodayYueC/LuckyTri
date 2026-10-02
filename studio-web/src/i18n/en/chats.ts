// English for the Chats section.
export default {
  // AddSession.vue
  "NEW PLACE": "NEW PLACE",

  // ChatsPage.vue
  "实时同步 · ": "Live · ",
  "同步失败：": "Sync failed: ",
  会话已添加: "Session added",
  "永久删除这个会话？它的消息和设置都会消失。":
    "Delete this session for good? Its messages and settings will be gone.",
  会话配置已保存: "Session settings saved",
  "确定清空这个会话的消息上下文吗？长期记忆不会删除。":
    "Clear this session's message context? Long-term memory is kept.",
  已发送: "Sent",
  反馈已保存: "Feedback saved",
  请选择会话: "Select a session",
  永久删除: "Delete for good",
  清空上下文: "Clear context",
  全部会话: "All sessions",

  // ReplaySheet.vue
  开口了: "Spoke up",
  扫了一眼: "Glanced",
  处理中: "Processing",
  旧稿作废: "Draft voided",
  已取消: "Cancelled",
  已中断: "Interrupted",
  真实聊天: "Real chat",
  模拟预览: "Simulated preview",
  测试回放: "Test replay",
  语境压缩: "Context compression",
  回放正在运行: "Replay is running",
  回放结束: "Replay finished",
  "输入 {v}（缓存读 {v2} / 写 {v3}）· 输出 {v4}":
    "Input {v} (cache read {v2} / write {v3}) · output {v4}",
  历史消息: "Message history",
  "↻ 加载": "↻ Load",
  序号: "No.",
  发送者: "Sender",
  消息: "Message",
  "当前会话暂无历史消息。": "This session has no message history yet.",
  起始序号: "From No.",
  截止序号: "To No.",
  "正在回放…": "Replaying…",
  回放这段对话: "Replay this conversation",
  "隔离回放：只测试回复，不发送 QQ，不修改真实记忆和 TA 的心智。":
    "Isolated replay: it only tests replies. Nothing is sent to QQ, and neither real memory nor TA's mind is changed.",
  处理记录: "Processing log",
  查看处理详情: "View processing details",
  "有新的消息处理记录后会显示在这里。":
    "New message processing records will show up here.",
  运行详情: "Run details",
  耗时: "Duration",
  模型调用: "Model calls",
  "{v} 次": "{v} calls",
  "展开下方查看上下文、模型输入与原始输出。":
    "Expand below to see the context, model input, and raw output.",
  "选择一条处理记录，查看最终上下文、Prompt、原始输出、Token 与耗时。":
    "Pick a record to see the final context, prompt, raw output, tokens, and duration.",
  回到那一刻: "Back to that moment",

  // SessionList.vue
  会话: "Sessions",
  "＋ 添加会话": "+ Add session",
  搜索名称或号码: "Search name or number",
  搜索会话: "Search sessions",
  参与中: "Taking part",
  已暂停: "Paused",
  "{v} 条没细看": "{v} not read closely",
  "参与：{v}": "Taking part: {v}",
  "暂无匹配的会话。": "No matching sessions.",
  "已归档 · {length}": "Archived · {length}",
  暂停参与: "Pause",
  开启参与: "Resume",

  // SessionPanel.vue
  近期细摘要: "Recent detailed summary",
  中期摘要: "Mid-term summary",
  较早摘要: "Earlier summary",
  远期摘要: "Distant summary",
  这个会话: "This session",
  反馈: "Feedback",
  还没有选中会话: "No session selected",
  "从左边选一个群聊或私聊。": "Pick a group or private chat on the left.",
  "TA 在这里的样子": "How TA is here",
  展开完整内容: "Show everything",
  "想成为：{aspiration}": "Wants to be: {aspiration}",
  "这段私聊给 TA 的感觉": "How this private chat feels to TA",
  "这个群给 TA 的感觉": "How this group feels to TA",
  刚来这里不久: "Only just arrived here",
  "在这里开不开口由 TA 自己决定：没有参与概率和冷却。TA 对这里每个人的感觉在「人际」里看。":
    "Whether to speak here is TA's own call: there is no participation probability or cooldown. How she feels about each person here is under People.",
  归档: "Archive",
  会话设置: "Session settings",
  "所有会话和独处都用模型库里的默认模型；其余已启用的模型按列表顺序做备用。她在这个聊天窗里用什么样子，由她自己从经历里决定。":
    "Every session and her time alone use the default model in the model library; other enabled models serve as backups in list order. How she presents herself in this chat is up to her, shaped by her experience.",
  "节能看图：只在被 @ 或明确要求时，看这一条和附近的图":
    "Save tokens on images: only look at this one and nearby ones when @-mentioned or asked directly",
  高级策略: "Advanced policy",
  "聚合窗口 ms": "Batching window (ms)",
  "最长等待 ms": "Longest wait (ms)",
  "近期原文条数（10–500）": "Recent raw messages (10–500)",
  一轮总字数: "Characters per turn",
  "上下文压缩：更早的聊天定期整理成分层摘要，越近越详细":
    "Context compression: older chat is periodically folded into layered summaries, more detailed the more recent",
  长期记忆: "Long-term memory",
  "倾诉、纠正和危机时额外复审一次回复":
    "Review the reply once more when someone confides, corrects her, or is in crisis",
  保存会话设置: "Save session settings",
  保存后下一轮生效: "Takes effect next turn after saving",
  "语境摘要 · {length} 段": "Context summaries · {length}",
  "还没有摘要。聊天超过近期原文条数后，更早的内容会自动整理到这里。":
    "No summaries yet. Once the chat passes the recent raw message count, older content is folded in here automatically.",
  摘要: "Summary",
  "{period} · {messages} 条消息": "{period} · {messages} messages",
  "未完：": "Unfinished: ",
  "针对具体回复评价口吻；这是 TA 在这个会话里听到的话，不会改写天性。":
    "Rate the tone of a specific reply. This is something TA hears in this session; it does not rewrite her nature.",
  "这句回复怎么样？": "How was this reply?",
  "还没有可以评价的回复。": "No replies to rate yet.",
  选择评价: "Choose a rating",

  // Transcript.vue
  "TA 扫了一眼": "TA glanced over it",
  "TA 看了，没出声": "TA looked but stayed quiet",
  "TA 睡着了，醒来再看": "TA is asleep and will look when she wakes",
  选择一段对话: "Pick a conversation",
  模拟消息: "Simulated message",
  模拟: "Simulated",
  为什么这么说: "Why she said that",
  "正在翻当时的记录…": "Looking through the record from then…",
  "TA 当时的理解：": "What TA understood then: ",
  "理由：": "Reason: ",
  "引用的资料：": "Sources cited: ",
  "这句怎么样？": "How was this one?",
  等待新的消息: "Waiting for new messages",
  "群聊与私聊消息会在这里实时出现；TA 扫一眼、没出声也会留下一条分隔线。":
    "Group and private messages appear here live. When TA glances and says nothing, a divider is left too.",
  "作为一条模拟消息走完整流程，写进模拟会话；不会发到 QQ，也不进入真实记忆。":
    "Runs the full pipeline as a simulated message and is written into the simulated session. It is not sent to QQ and does not enter real memory.",
  "体验用户 ID": "Trial user ID",
  "以这位群友的身份说一句…": "Say something as this group member…",
  "视为 @": "Count as @-mention",
  发送模拟消息: "Send simulated message",
  "真实模式下不能模拟消息。想看看 TA 会怎么回，可以「和 TA 聊聊」——那是试聊，什么都不写入。":
    "Messages cannot be simulated in real mode. To see how TA would reply, use “Talk with TA”: that is a trial chat and nothing is written.",
} as Record<string, string>;
