// English for the System section (models, embedding, search, runtime, page shell).
export default {
  版本与更新: "Version and updates",
  检查更新: "Check for updates",
  "正在检查…": "Checking…",
  尚未检查更新: "Not checked yet",
  有新版本可用: "An update is available",
  已是最新发布版本: "Up to date with the latest release",
  "当前版本领先于 npm 发布版本": "This version is ahead of the npm release",
  暂时无法检查更新: "Unable to check for updates right now",
  当前版本: "Current version",
  "npm 最新版本": "Latest on npm",
  上次成功检查: "Last successful check",
  "暂时无法连接 npm 或读取版本信息，请稍后重试。":
    "Unable to reach npm or read version information. Please try again later.",
  "点击时才检查，五分钟内复用结果。检查更新不会自动安装或重启。":
    "Checks only when clicked and reuses results for five minutes. Checking does not install updates or restart the instance.",
  "源码安装：更新 main、安装依赖并构建后重启，保留现有数据与配置。":
    "Source installation: update main, install dependencies, rebuild and restart, keeping existing data and configuration.",
  "停止实例后执行升级命令，再启动 LuckyTri。":
    "Stop the instance, run the update command, then start LuckyTri again.",
  发布说明: "Release notes",
  "DATA · 导入与导出": "DATA · Import and export",
  "带上记忆，继续生活。": "Carry her memories forward.",
  "导出数据库内的聊天、记忆、待办、作品、知识与设置。插件文件、知识库原始文件和本机 .env 不在数据包中。":
    "Export chats, memories, tasks, works, knowledge and settings stored in the database. Plugin files, original knowledge files and the local .env are outside the package.",
  "数据包包含私聊内容和模型设置中的密钥，请存放在你信任的位置。导入前会校验，确认后才替换当前数据。":
    "The package includes private chats and keys saved in model settings. Store it somewhere you trust. Imports are checked first and replace current data only after confirmation.",
  导出数据包: "Export data package",
  选择导入文件: "Choose import file",
  导入数据文件: "Import data file",
  "支持 .luckytri 数据包和已有 SQLite 备份，单个文件最多 {size} GiB。":
    "Accepts .luckytri packages and existing SQLite backups, up to {size} GiB per file.",
  "正在保留快照并重启加载，请等待…":
    "Saving the snapshot and restarting. Please wait...",
  "正在上传数据文件…": "Uploading the data file...",
  "正在生成完整数据包…": "Preparing the complete data package...",
  "正在校验数据文件…": "Checking the data file...",
  "上次数据导入已完成，自动回复在导入时关闭。请检查连接、模型和待办后再开启；插件需重新安装或确认权限。":
    "The last import completed with automatic replies turned off. Check connections, models and tasks before enabling them. Plugins need reinstalling or permission review.",
  "校验通过 · 尚未导入": "Verified · Not yet imported",
  "数据库版本 {from} → {to}": "Database version {from} -> {to}",
  导入并重启: "Import and restart",
  取消导入: "Cancel import",
  "用这份数据替换当前数据，并保留导入前快照。实例将重启，导入后自动回复关闭。本机管理密码与 QQ 连接配置保持不变。":
    "Replace current data with this file and retain a snapshot first. The instance will restart with automatic replies off. The local management password and QQ connection settings are preserved.",
  确认导入数据: "Confirm data import",
  "数据包已生成，浏览器将开始下载":
    "Data package ready. Your browser will begin downloading it.",
  数据处理失败: "Data processing failed",
  "数据文件已过期，请重新选择": "The data file expired. Choose it again.",
  "等待数据处理超时，请检查实例运行状态":
    "Timed out waiting for data processing. Check the instance status.",
  数据文件超过导入大小限制: "The data file exceeds the import size limit",
  数据上传失败: "Data upload failed",
  导入前快照: "Pre-import snapshot",
  聊天记录: "Chat records",
  请先登录管理台: "Sign in to the studio first",
  QQ: "QQ",

  // EmbeddingProfile.vue
  知识向量: "Knowledge vectors",
  "API 地址": "API URL",
  模型名称: "Model name",
  知识向量模型已保存: "Knowledge vector model saved",
  "连接成功，向量维度 {dimensions}":
    "Connected. Vector dimensions: {dimensions}",
  知识向量模型: "Knowledge vector model",
  "单独配置资料检索使用的模型。更换对话模型后仍使用这里的配置。更换向量模型后，可在资料书架逐份重建向量；原文仍能通过关键词检索。":
    "Configure the model used for material retrieval separately. It keeps using this setup after you change the chat model. After changing the vector model, rebuild vectors document by document on the bookshelf; the original text can still be found by keyword search.",
  "当前兼容旧配置，跟随默认模型。保存后改用独立配置。":
    "Currently using the old configuration and following the default model. Saving switches to a separate configuration.",
  启用知识向量: "Enable knowledge vectors",
  "独立 API Key": "Separate API key",
  填写向量服务密钥: "Enter the vector service key",
  "向量维度（0 表示自动）": "Vector dimensions (0 = automatic)",
  每批段落数: "Passages per batch",
  保存向量模型: "Save vector model",
  测试向量连接: "Test vector connection",
  配置已载入: "Configuration loaded",

  // ModelLibrary.vue
  极低: "Minimal",
  中: "Medium",
  极高: "Extra high",
  最深: "Deepest",
  "已保存 {value}": "Saved {value}",
  "火山方舟 Coding Plan": "Volcengine Ark Coding Plan",
  "亚马逊 Bedrock": "Amazon Bedrock",
  通义千问: "Qwen",
  "智谱 GLM": "Zhipu GLM",
  "小米 MiMo": "Xiaomi MiMo",
  自定义供应商: "Custom provider",
  按所选模型填写上下文和输出参数:
    "Fill in context and output parameters for the chosen model",
  "填写模型 ID 和对应参数": "Enter the model ID and its parameters",
  "上下文 {context} · 输出 {v}": "Context {context} · output {v}",
  开启: "On",
  "放弃当前模型草稿？": "Discard the current model draft?",
  放弃: "Discard",
  "确定删除这个模型？": "Delete this model?",
  删除模型: "Delete model",
  "正在测试「{v}」…": "Testing “{v}”…",
  "✓ {v} 连接成功 · {latency} ms": "✓ {v} connected · {latency} ms",
  "＋ 新增模型": "+ Add model",
  "群聊、私聊和独处都使用默认模型。其余已启用的模型按这里的顺序作为备用。关掉的模型不会被调用。":
    "Group chats, private chats and time alone all use the default model. Other enabled models serve as backups in this order. Models that are switched off are never called.",
  "还没有模型。": "No models yet.",
  "{length} 个模型": "{length} models",
  默认模型: "Default model",
  备用模型: "Backup model",
  模型档案: "Model profile",
  新模型: "New model",
  "默认模型 · ": "Default model · ",
  密钥已保存: "Key saved",
  待填写密钥: "Key needed",
  连接: "Connection",
  同厂商模型: "Models from the same vendor",
  供应商: "Provider",
  "例如 deepseek、openai": "e.g. deepseek, openai",
  "已保存，留空则保留": "Saved; leave empty to keep it",
  填写供应商提供的密钥: "Enter the key from the provider",
  容量与思考: "Capacity and thinking",
  "官方按输入长度分档计价的模型可以在标准和百万之间切换；输出上限默认是官方最大值，思考强度只列出这个模型支持的档位。":
    "For models the vendor prices by input length, you can switch between standard and million-token tiers. The output limit defaults to the vendor's maximum, and thinking effort lists only the levels this model supports.",
  上下文容量: "Context capacity",
  "最大输入 Token": "Max input tokens",
  "最大输出 Token": "Max output tokens",
  思考强度: "Thinking effort",
  高级参数与模型能力: "Advanced parameters and model abilities",
  "随机程度 Temperature": "Randomness (temperature)",
  "采样范围 Top P": "Sampling range (top P)",
  知识检索模型: "Knowledge retrieval model",
  留空跟随对话模型: "Leave empty to follow the chat model",
  "打开图片理解后，聊天里的图片会先在本机读取，再连同画面交给这个模型。主模型不能看图时，到会话设置另选一个打开了图片理解的视觉兼容模型。":
    "With image understanding on, images in chat are read locally first, then handed to this model together with the picture. If the main model cannot see images, pick another vision-capable model with image understanding on in the session settings.",
  "JSON 输出": "JSON output",
  工具调用: "Tool calls",
  "正在保存…": "Saving…",
  保存模型: "Save model",
  已保存的模型才会用来测试和回复:
    "Only a saved model is used for tests and replies",
  启用这个备用模型: "Enable this backup model",
  设为默认模型: "Set as default model",
  "正在测试…": "Testing…",
  保存后测试此模型: "Save, then test this model",
  测试此模型连接: "Test this model's connection",
  还没有模型: "No models yet",
  "常见厂商会预填模型参数；OpenRouter 可选 GPT-6 预设，也可用自选模型手动填写模型 ID 和参数。":
    "Common vendors come with parameters prefilled. On OpenRouter you can pick a GPT-6 preset, or choose your own model and enter its ID and parameters by hand.",
  "TOKEN LEDGER · 累计用量": "TOKEN LEDGER",
  一路聊到现在: "All the way up to now",
  "统计本机账本记录的模型调用；缓存 Token 已包含在输入量里。":
    "Counts the model calls recorded in this machine's ledger; cached tokens are already included in the input.",
  "累计 Token": "Total tokens",
  输入: "Input",
  输出: "Output",
  缓存命中: "Cache hits",
  "（输入子项）": "(part of input)",
  调用次数: "Calls",
  "从 {v} 开始记录 · {v2} 为模型返回用量":
    "Recorded since {v} · {v2} reported by the model",
  "· {v} 次调用按文本估算": "· {v} calls estimated from text",
  "还没有模型调用记录。": "No model calls recorded yet.",
  "更新中…": "Updating…",
  "刷新统计 ↻": "Refresh stats ↻",
  选择模型: "Choose a model",
  "先选供应商，再挑具体模型；支持搜索。火山方舟 Coding Plan 已预填套餐专用接口与型号参数，请勿换成普通推理 API 地址。":
    "Pick a provider first, then a specific model; search is supported. Volcengine Ark Coding Plan comes prefilled with the plan's dedicated endpoint and model parameters; do not swap in a regular inference API URL.",
  搜索模型或供应商: "Search models or providers",
  "例如：火山方舟、Kimi K3、DeepSeek": "e.g. Volcengine Ark, Kimi K3, DeepSeek",
  "{length} 个预设": "{length} presets",
  "填写你在 OpenRouter 选择的模型 ID":
    "Enter the model ID you chose on OpenRouter",
  "没有找到匹配的模型预设。": "No matching model presets found.",
  已保存并应用: "Saved and applied",
  模型库: "Model library",
  已关闭: "Off",
  "超时（毫秒）": "Timeout (ms)",

  // Runtime.vue
  自动备份: "Automatic backup",
  "自动备份出错，稍后重试": "Automatic backup failed; it will retry later",
  "自动备份，运行一阵后会做第一份":
    "Automatic backup; the first one is made after running a while",
  "上次自动备份 · {mb} MB · 已留 {count}/{keep} 份":
    "Last automatic backup · {mb} MB · {count}/{keep} kept",
  "TA 现在可以说话吗": "Can TA speak right now?",
  允许参与聊天: "Allow taking part in chats",
  "总开关。关掉后 TA 不看也不回任何会话，心智照常保存。":
    "Master switch. When off, TA neither reads nor replies in any session, and her mind is still saved as usual.",
  "仅模拟运行，不向 QQ 发送": "Simulation only; nothing is sent to QQ",
  "模拟模式下，「对话」里可以发模拟消息走完整流程；它们写进模拟会话，不进入真实记忆。":
    "In simulation mode you can send simulated messages through the full pipeline from Chats; they are written to simulated sessions and never enter real memory.",
  保存运行状态: "Save run state",
  "已保存，立刻生效": "Saved; takes effect immediately",
  参与中的会话: "Sessions taking part",
  可用模型: "Models available",
  在线: "Online",
  离线: "Offline",
  "QQ 连接": "QQ connection",
  运行开关: "Run switches",

  // BackupManager.vue
  数据与备份: "Data and backups",
  完整备份: "Full backup",
  迁移快照: "Migration snapshot",
  旧版本备份: "Older-version backup",
  升级前快照: "Pre-upgrade snapshot",
  备份整理规则已保存: "Backup cleanup rules saved",
  "将清理选中的 {count} 份备份，释放约 {size}。这些历史恢复点清理后无法从本机找回。":
    "Remove {count} selected backups and free about {size}? These restore points cannot be recovered from this computer afterwards.",
  清理所选备份: "Remove selected backups",
  清理所选: "Remove selected",
  "已清理 {count} 份备份，释放 {size}":
    "Removed {count} backups and freed {size}",
  "DATA · 数据与备份": "DATA · BACKUPS",
  "留住重要的，整理重复的。": "Keep what matters. Clear the repeats.",
  "这里管理历史备份。聊天、记忆和作品仍在正在运行的数据库里，不会被列入清理。":
    "Manage historical backups here. Chats, memories, and works in the live database are never listed for cleanup.",
  可管理的历史备份: "Historical backups",
  份数据库副本: "Database copies",
  按当前规则可定时整理: "Eligible under current rules",
  定时整理: "Scheduled cleanup",
  每天给备份留一点空间: "Make room for backups each day",
  启用定时整理: "Enable scheduled cleanup",
  每天执行时间: "Daily cleanup time",
  完整备份保留天数: "Keep full backups for days",
  完整备份最多保留份数: "Maximum full backups to keep",
  "时间按服务器本地时区 {zone}。完整备份超过保留天数或数量上限便会定时整理；数量填 0 表示不保留完整备份。手动清理可选择完整备份和迁移快照，执行前会校验同一实例的近期自动恢复点。":
    "Times use the server's local time zone ({zone}). Full backups beyond either the age or count limit are scheduled for cleanup. Set the count to 0 to retain no full backups. Full and migration snapshots can be selected manually; a recent restore point from this instance is verified first.",
  "上次整理未执行：{error}": "Last cleanup could not run: {error}",
  "上次整理：{time} · {count} 份 · {size}":
    "Last cleanup: {time} · {count} copies · {size}",
  "处理中…": "Working…",
  保存整理规则: "Save cleanup rules",
  手动整理: "Manual cleanup",
  挑选历史恢复点: "Choose historical restore points",
  "自动备份已有自己的轮换规则。迁移、旧版本和升级前快照只由你手动挑选；清理前会再次核对文件和恢复点。":
    "Automatic backups already rotate on their own. Migration, older-version, and pre-upgrade snapshots are removed only when you select them. Files and restore points are checked again before cleanup.",
  选中规则建议: "Select suggested",
  选中完整备份: "Select full backups",
  取消选择: "Clear selection",
  有校验清单: "Has manifest",
  "；部分未清理，详情见列表":
    "; some were not removed, see the list for details",
  "部分备份未清理，请刷新列表后重试":
    "Some backups were not removed. Refresh the list and try again.",
  旧备份无清单: "No manifest",
  保留恢复点: "Protected restore point",
  "已选 {count} 份 · 约 {size}": "Selected {count} · about {size}",

  // SearchProfile.vue
  不限: "Unlimited",
  搜索配置已保存并生效: "Search settings saved and active",
  "{provider} 联网检索": "{provider} web search",
  "{source}测试通过，返回 {count} 条资料。测试不占用每日查询额度；当前填写的配置尚未保存。":
    "{source} test passed and returned {count} results. Tests do not use the daily query allowance; the settings you entered are not saved yet.",
  "{source}测试通过，返回 {count} 条资料。测试不占用每日查询额度。":
    "{source} test passed and returned {count} results. Tests do not use the daily query allowance.",
  "{error}。本次测试不占用每日查询额度。":
    "{error}. This test did not use the daily query allowance.",
  "SEARCH · 独立搜索": "SEARCH",
  接触世界的资料: "Material from the world",
  "配置后优先联网检索。未配置密钥或关闭独立搜索时，使用当前模型整理已有知识。":
    "Once configured, web search comes first. Without a key, or with standalone search off, the current model organizes what it already knows.",
  "当前生效：{v}。表单修改保存后生效。":
    "Active now: {v}. Changes in the form take effect once saved.",
  "{provider} · 联网检索资料": "{provider} · web search material",
  启用独立搜索: "Enable standalone search",
  提供方: "Provider",
  搜索提供方: "Search provider",
  搜索地址: "Search URL",
  独立密钥: "Separate key",
  填写该提供方的搜索密钥: "Enter this provider's search key",
  每次结果数: "Results per search",
  每日查询上限: "Daily query limit",
  "可手动调整；0 表示不限。保存后立即生效。":
    "Adjustable by hand; 0 means unlimited. Takes effect as soon as saved.",
  "今日有效查询 {v} / {limitLabel}": "Valid queries today {v} / {limitLabel}",
  "{v} 次进行中 · {v2} 次失败 · {v3} 次测试":
    "{v} in progress · {v2} failed · {v3} tests",
  "测试当前填写的配置，不会自动保存。失败与连接测试不占本地每日额度；提供方的账户额度由提供方管理。":
    "Tests the settings as entered without saving them. Failed and connection tests do not use the local daily allowance; the provider manages its own account quota.",
  保存搜索: "Save search",
  测试连接: "Test connection",

  // SystemPage.vue
  "当前设置还没保存，离开这个分区吗？":
    "These settings are not saved. Leave this section?",
  未保存的修改: "Unsaved changes",
  放弃修改: "Discard changes",
  继续编辑: "Keep editing",
  "THE WORLD AROUND HER · 系统": "THE WORLD AROUND HER",
  "让她与世界，": "Let her and the world",
  "温柔相连。": "connect gently.",
  "连接、模型与运行方式都在这里。每一处改变，都可以看见结果。":
    "Connection, models and the way she runs are all here. Every change shows its result.",
  "正在与 QQ 相连": "Connecting to QQ",
  "等待 QQ 连接": "Waiting for QQ to connect",
  系统的分区: "System sections",
  独立搜索: "Standalone search",
} as Record<string, string>;
