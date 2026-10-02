// English for the Time section (today's agenda, tasks, works, experiences).
export default {
  // DayAgenda.vue
  休息建议: "Rest suggestion",
  自由安排: "Free time",
  作息安排: "Daily rhythm",
  已发生: "Happened",
  此前时长未单独记录: "Earlier duration was not recorded separately",
  "实际投入 {v} 分钟": "Actually spent {v} min",
  今日时间表: "Today's timetable",
  时间表显示范围: "Timetable range",
  此刻附近: "Around now",
  全天: "All day",
  实际时段: "Actual spans",
  选定的安排: "Chosen plans",
  "作息 / 空白": "Rhythm / open time",
  "● 伴随交流": "● with chat",
  " · 伴随交流": " · with chat",
  现在: "Now",
  接下来: "Next",
  "已经走过的时段 · {length} 段": "Spans already past · {length}",
  "今天还没有活动记录，实际开始后会显示在上方。":
    "No activity recorded today yet; once something actually starts it will show above.",
  她定下的安排: "Plans she set",
  "还没有选定活动时间，留白由她再决定，不按待办队列填满。":
    "No time chosen for an activity yet. She will decide what to do with the open time; it is not filled from the to-do queue.",
  "{label} · {v} · {durationMinutes} 分钟 · {scope}":
    "{label} · {v} · {durationMinutes} min · {scope}",
  自己的安排: "Her own plans",
  "可以想自己的事，也可以歇着；不算已做过":
    "She can think her own thoughts or just rest; it does not count as done",
  "预计，做完眼前这段再调整":
    "Estimated; adjust after the current span is done",
  "进入睡眠安排，醒来后再选择续接时间。":
    "Goes into the sleep schedule; she picks a time to resume after waking.",
  "有更高优先级安排，届时先让位，之后再选续接时间。":
    "A higher-priority plan comes first then; she picks a time to resume afterwards.",
  "睡眠安排：{v}": "Sleep plan: {v}",
  "已记下，还没选时间 · {length} 件": "Noted, no time chosen yet · {length}",
  "暂时停下来，进度保留 · {length} 件":
    "Paused for now, progress kept · {length}",
  "需要条件或调整约定 · {length} 件":
    "Needs a condition or a changed agreement · {length}",
  外部建议: "Outside suggestion",

  // ExperienceLog.vue
  体验记录: "Experience log",
  "EXPERIENCES · 留下的经历": "EXPERIENCES",
  最近做过的事: "What she did lately",
  "故事写到哪里，玩过什么，又留下了哪些想法。":
    "Where the story got to, what she played, and the thoughts it left behind.",
  "{label}记录": "{label} record",
  "{v} · {characters} 字 · 版本 {version}":
    "{v} · {characters} chars · version {version}",
  已保存成果: "Finished work saved",
  已保存草稿: "Draft saved",
  "这条旧记录没有保存摘要。": "This older record has no saved summary.",
  "来自 {title}": "From {title}",
  阅读这一稿: "Read this draft",
  阅读完整记录: "Read the full record",
  查看项目: "View project",
  "接触的内容 · {length} 份": "Material met · {length}",
  未命名资料: "Untitled material",
  这里还没有经历记录: "No experience records here yet",
  "做过的事与保存的成果，会逐渐出现在这里。":
    "What she did and the works she saved will gradually appear here.",
  游戏客户端连接: "Game client connection",
  开发中: "In development",
  "客户端控制尚未接入。已有的游玩记录可以在上方阅读。":
    "Client control is not connected yet. Existing play records can be read above.",

  // TimePage.vue: states
  "ToDo · 待办": "To do",
  "Scheduled · 已安排": "Scheduled",
  "Doing · 正在做": "Doing",
  "Paused · 暂停": "Paused",
  "Waiting · 等待": "Waiting",
  "Done · 已完成": "Done",
  "Abandoned · 已放下": "Abandoned",
  "完成，尚未交付": "Finished, not yet delivered",
  暂缓交付: "Delivery postponed",
  暂不分享: "Not sharing for now",
  待继续交付: "Delivery to continue",
  已完整交付: "Fully delivered",
  已整理并汇报: "Sorted and reported",
  "送达不确定，等待核对": "Delivery uncertain, awaiting check",
  正在交付: "Being delivered",
  普通: "Normal",
  最高: "Highest",
  需要调整约定: "Needs a changed agreement",
  待想具体: "Needs thinking through",
  "Waiting · 等条件": "Waiting for a condition",
  "ToDo · 待选时间": "To do · needs a time",
  "Scheduled · 已选时间": "Scheduled · time chosen",
  "Paused · 进度保留": "Paused · progress kept",
  "{v} 分钟": "{v} min",

  // TimePage.vue: actions and dialogs
  "最早开始时间（YYYY-MM-DD HH:mm）。截止时间保留原安排。":
    "Earliest start time (YYYY-MM-DD HH:mm). The deadline keeps its original plan.",
  安排时间: "Schedule time",
  继续: "Continue",
  "这次安排投入多少分钟（5 至 240）？":
    "How many minutes for this session (5 to 240)?",
  投入时间: "Time to spend",
  "留下放下这件事的原因。": "Leave the reason for letting this go.",
  "留下这次调整的原因。": "Leave the reason for this change.",
  调整安排: "Adjust plan",
  管理台调整: "Adjusted from the console",
  "提出选题、续写方向或修改想法。她会自行决定是否采纳。":
    "Suggest a topic, a direction to continue, or an edit. She decides for herself whether to take it.",
  给她一个建议: "Give her a suggestion",
  留下建议: "Leave a suggestion",
  这个项目已有待处理事项: "This project already has something pending",
  "建议已保存，等待她的选择": "Suggestion saved; it waits for her choice",
  专注安排已保存: "Focus plan saved",
  "已记下，空下来时回看说过的话":
    "Noted; she will look back at what was said when free",
  "已记下，让她重新想具体时间与投入时长":
    "Noted; she will rethink the exact time and duration",

  // TimePage.vue: header
  "TIME · 时间": "TIME",
  "日子在走，": "Days keep moving,",
  "我也有自己的事。": "and I have things of my own.",
  "想做的事，正在留下的作品，与世界相遇的每一段。":
    "The things she wants to do, the works she is leaving behind, and every stretch spent meeting the world.",
  留一点时间给自己: "Leave some time for herself",
  时间的分区: "Time sections",
  今日: "Today",
  待办: "To do",
  作品库: "Works",
  持续项目: "Ongoing projects",
  重试: "Retry",
  "正在取回这段生活…": "Fetching this stretch of life…",

  // TimePage.vue: now
  此刻的主活动: "Main activity right now",
  正在准备: "Preparing",
  刚开始这一段: "Just started this span",
  "本次已投入 ": "Spent so far: ",
  "她安排 {v} 开始，这次想投入 {durationMinutes} 分钟。":
    "She planned to start at {v} and wants to spend {durationMinutes} min this time.",
  "本段预计 {v} · 还需约 {v2}": "This span ends around {v} · about {v2} left",
  "从自己的打算接着做。": "Continuing from her own intentions.",
  "正在推进当前步骤。": "Working on the current step.",
  "查看安排 →": "See plans →",
  这会儿没有主活动: "No main activity right now",
  "自己选择接下来做什么，也可以歇着。":
    "She chooses what to do next, or simply rests.",
  "下一项：{title} · {v} 开始 · {durationMinutes} 分钟":
    "Next: {title} · starts {v} · {durationMinutes} min",
  让她重新想想安排: "Let her rethink the plan",
  今天: "Today",
  "实际活动投入 · {energyLabel} · {mood}":
    "Time actually spent · {energyLabel} · {mood}",
  "普通交流可以伴随进行，短消息不会自动暂停。":
    "Ordinary chat can go on alongside; short messages do not pause it automatically.",
  "翻开日记 →": "Open the diary →",
  独处时理一理: "Sorting things out while alone",
  "自己的打算，说过的约定": "Her own intentions and what she has promised",
  "空下来时，她会想一件自己愿意做的小事，也会回看有没有漏下答应别人的事。可以选择歇着。":
    "When free, she thinks of a small thing she would like to do, and checks whether she missed anything she promised others. She may choose to rest.",
  "最近：{reason}": "Lately: {reason}",
  "还有 {pendingReplies} 条已说过的话等着分批回看。":
    "{pendingReplies} things already said are waiting to be reviewed in batches.",
  正在整理自己的生活: "Sorting out her own life",
  "已记下，空下来时整理": "Noted; she will sort it when free",
  空下来整理一下约定: "Sort out promises when free",
  专注与休息安排: "Focus and rest plans",
  "默认专注段（分钟）": "Default focus span (minutes)",
  "没有另行选择时使用；她自己的安排优先。":
    "Used when nothing else is chosen; her own plans come first.",
  "休息建议（分钟）": "Rest suggestion (minutes)",
  "保存步骤间隔（分钟）": "Step save interval (minutes)",
  活动节奏: "Activity pace",
  "默认 1.25 倍，所有活动按现实时间逐段推进。":
    "Default 1.25×; every activity advances span by span in real time.",
  "想自己的安排（间隔分钟）":
    "Thinking about her own plans (interval, minutes)",
  "有空才考虑，可以决定休息。":
    "Only considered when free; she may decide to rest.",
  "回看说过的话（间隔分钟）": "Reviewing what was said (interval, minutes)",
  "分批整理约定，保留去重与原来的选择。":
    "Sorts promises in batches, keeping deduplication and the original choices.",
  正在保存: "Saving",
  保存安排: "Save plan",
  查看全部待办: "See all to-dos",
  搜索标题: "Search titles",
  搜索标题或项目: "Search titles or projects",
  搜索: "Search",
  任务状态: "Task status",
  自己的计划: "Her own plans",
  优先级: "Priority",
  "优先级：": "Priority: ",
  "{v} {v2} — {v3} · 这次 {durationMinutes} 分钟":
    "{v} {v2} — {v3} · {durationMinutes} min this time",
  管理台安排: "Set from the console",
  她选定: "She chose",
  "本段开始 {v}": "This span began {v}",
  条件满足后建议: "Suggested once the condition is met",
  已安排: "Scheduled",
  "需要解决上面的条件，再选择时间":
    "Resolve the conditions above, then choose a time",
  "进度已保存，之后再安排续接时间":
    "Progress saved; a time to resume is arranged later",
  "已记下，等她选择具体时间": "Noted; waiting for her to choose an exact time",
  "· 本段预计 {v} · 本段已投入 {v2}":
    "· this span ends around {v} · spent this span {v2}",
  "· 还需约 {v}": "· about {v} left",
  "· 此前时长未单独记录": "· earlier duration was not recorded separately",
  正在准备这一段: "Preparing this span",
  尚未开始本段投入: "Has not started spending time on this span",
  "本段目标：{outcome}": "Goal for this span: {outcome}",
  "下一步：{next}": "Next step: {next}",
  "来源与原安排 · {length} 条": "Sources and original plans · {length}",
  "原话日期参考 {v}，不作为逾期判断。":
    "Date mentioned originally: {v}. Not used to judge lateness.",
  "已合并到唯一事项，保留这条原记录。":
    "Merged into a single item; this original record is kept.",
  阅读已有正文: "Read the existing text",
  暂停: "Pause",
  重新安排: "Reschedule",
  "{v} · 第 {ordinal} 篇": "{v} · piece {ordinal}",
  完成稿: "Finished piece",
  草稿: "Draft",
  "{characters} 字 · 版本 {version}": "{characters} chars · version {version}",
  独处留下的东西: "What time alone left behind",
  游戏: "Game",
  连载: "Serial",
  在继续: "Continuing",
  已完结: "Finished",
  暂时放下: "Set aside for now",
  打开项目: "Open project",
  作品还在等待第一笔: "The work is still waiting for its first stroke",
  这里还没有记录: "No records here yet",
  "实际发生并保存之后，这里才会出现内容。":
    "Content shows up here only after something actually happens and is saved.",
  上一页: "Previous page",
  下一页: "Next page",
  作品: "Work",
  她留下的正文: "The text she left",
  "{v} · {length} 字": "{v} · {length} chars",
  版本: "Version",
  作品版本: "Work version",
  导出正文: "Export text",
  查看项目与设定: "View project and settings",
  她自己的方向: "Her own direction",
  设定与未解决线索: "Settings and unresolved threads",
  人物: "Characters",
  世界: "World",
  未解决线索: "Unresolved threads",
  资料主题: "Material topic",
  建议续写: "Suggest continuing",
  建议修改: "Suggest an edit",
  建议方向: "Suggest a direction",
  已经留下的篇章: "Pieces already left",
  "第 {ordinal} 篇 · {title}": "Piece {ordinal} · {title}",
  接触的资料: "Material met",
  资料: "Material",
  "模型知识整理 · 未经联网核验":
    "Organized from model knowledge · not verified online",
  实际返回的摘录: "Excerpts actually returned",
  打开来源: "Open source",
  "基于模型已有知识，具体剧情与章节仍需核验。":
    "Based on what the model already knows; specific plot and chapters still need verification.",
} as Record<string, string>;
