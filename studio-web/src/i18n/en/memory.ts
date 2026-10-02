// English for the Memory section.
export default {
  // KnowledgeShelf.vue
  "已重建 {chunks} 段向量": "Rebuilt vectors for {chunks} passages",
  文档已切分入库: "Document split and stored",
  "给 TA 留一点可以读的东西": "Leave TA something to read",
  "存放可供聊天参考的资料，和自动记录的会话记忆分开管理。共享集合里的文章，TA 独处时也会挑着读。":
    "Holds reference material for chats, managed separately from the memory recorded automatically from sessions. Articles in a shared collection are also something TA picks from to read when alone.",
  文档集合: "Document collections",
  "资料书架，{length} 份资料": "Bookshelf, {length} documents",
  "正在重建…": "Rebuilding…",
  重建向量: "Rebuild vectors",
  书架还空着: "The bookshelf is still empty",
  "在下面放一份资料，TA 就能在聊天里查到，独处时也可能去读。":
    "Add a document below and TA can look it up in chat, and may read it when alone.",
  "＋ 添加一份资料": "+ Add a document",
  标题: "Title",
  粘贴正文: "Paste the text",
  保存到书架: "Save to bookshelf",
  "保存之后，TA 才能在聊天和独处时读到":
    "TA can read it in chat and when alone only after you save",
  检索测试: "Search test",
  试着搜索一个关键词: "Try searching a keyword",
  检索: "Search",
  "没有找到相关资料。": "No related material found.",
  资料书架: "Bookshelf",

  // MemoryArchive.vue
  记忆已写入: "Memory saved",
  "确定删除已选的 {length} 条记忆吗？":
    "Delete the {length} selected memories?",
  删除记忆: "Delete memories",
  "已删除 {v} 条记忆": "Deleted {v} memories",
  "确定清空本会话的 {count} 条可删除记忆吗？":
    "Clear the {count} deletable memories of this session?",
  清空本会话记忆: "Clear this session's memories",
  记忆已整理: "Memory sorted",
  在哪里知道的: "Where she learned it",
  选择会话: "Choose a session",
  关于谁: "About whom",
  按人筛选: "Filter by person",
  所有人: "Everyone",
  "搜索记忆、人物或关键词": "Search memories, people or keywords",
  搜索记忆: "Search memories",
  "＋ 手动记忆": "+ Add memory",
  最近发生了什么: "What happened recently",
  记忆档案: "Memory archive",
  刷新总结: "Refresh summary",
  "整理中…": "Sorting…",
  立即整理: "Sort now",
  "请选择会话以查看最近的记忆总结。":
    "Choose a session to see its recent memory summary.",
  尚未整理: "Not sorted yet",
  展开: "Expand",
  全选: "Select all",
  取消选择: "Clear selection",
  "删除已选 {v}": "Delete selected {v}",
  清空本会话: "Clear this session",
  "选择记忆：": "Select memory: ",
  已锁定: "Locked",
  "关于 {v} · {v2} · 把握 {v3}%": "About {v} · {v2} · confidence {v3}%",
  在这里知道的: "Learned here",
  别处知道的: "Learned elsewhere",
  "编辑记忆：": "Edit memory: ",
  保存修改: "Save changes",
  编辑后要点保存: "Save after editing",
  "再显示 20 条": "Show 20 more",
  这里还有空白: "Nothing here yet",
  "别人说「记住……」、聊天积累后的自动整理，或你手动添加的事会出现在这里。TA 对所有会话只有一份记忆：别处知道的事只在相关时想起，私下知道的不当众说，要 TA 保密的不离开原处。":
    "Things people ask her to remember, what is sorted automatically as chats pile up, and what you add by hand will appear here. TA has a single memory across all sessions: what she learned elsewhere comes up only when relevant, what she knows privately is not said in public, and what she was asked to keep secret does not leave where it was told.",
  "共 {length} 条记忆": "{length} memories in total",
  共享与锁定的记忆不会被批量选中:
    "Shared and locked memories are not picked up by bulk selection",
  手动记住一件事: "Remember something by hand",
  所属会话: "Session",
  "用户 ID": "User ID",
  "选择昵称，或填写用户 ID": "Choose a nickname, or enter a user ID",
  已确认的事实: "A confirmed fact",
  新增人工记忆: "Add a manual memory",

  // MemoryPage.vue
  "MEMORY · 记忆": "MEMORY",
  "见过的人与事，": "The people and things she has met",
  "会慢慢有了重量。": "slowly gain weight.",
  "记住重要的，也允许改变看法。":
    "Remember what matters, and allow views to change.",
  记忆的分区: "Memory sections",
  "TA 记得的事": "What TA remembers",
  "先在「对话」里添加一个会话，TA 才有地方认识人、记住事。":
    "Add a session under Chats first, so TA has somewhere to meet people and remember things.",
} as Record<string, string>;
