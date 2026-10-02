// English for the messages the API returns as `error`. The Chinese text is the
// key, exactly as the code writes it. `{0}` stands for a value the code puts
// into the message; patterns are used when a message carries one.
export const ERRORS = {
  // app.js
  不允许跨站访问: "Cross-site access is not allowed",
  请输入管理令牌: "Enter the admin token",
  "请提交 JSON 对象": "Submit a JSON object",
  请求内容过大: "The request is too large",
  "JSON 格式无效": "The JSON is invalid",
  "请求失败，请检查输入或服务日志":
    "The request failed. Check the input or the service log.",

  // channels
  "这个会话属于另一种 QQ 接入方式，当前不能向它发送":
    "This session belongs to the other QQ connection method and cannot be sent to right now",
  "QQ 尚未连接": "QQ is not connected yet",
  "QQ 连接已断开": "The QQ connection was lost",
  "无法连接 QQ 开放平台": "Could not reach the QQ Open Platform",
  "QQ 开放平台没有找到鉴权接口":
    "The QQ Open Platform has no authentication endpoint",
  "无法获取 AccessToken": "Could not get an AccessToken",
  "尚未填写 AppID 和 AppSecret":
    "AppID and AppSecret have not been entered yet",
  "QQ 开放平台没有返回网关地址":
    "The QQ Open Platform returned no gateway address",
  "QQ 官方机器人尚未连接": "The QQ official bot is not connected yet",
  "这个会话不属于当前连接的 QQ 官方机器人":
    "This session does not belong to the QQ official bot that is connected",
  会话身份不完整: "The session identity is incomplete",
  "会话 ID 无效": "The session ID is invalid",

  // core/api.js
  会话不存在: "The session does not exist",
  归档开关无效: "The archive switch is invalid",
  没有要修改的内容: "Nothing to change",
  "请先移出面板，再永久删除会话":
    "Remove it from the panel first, then delete the session for good",
  "模型档案数量应为 0–30": "The number of model profiles must be 0–30",
  "模型 ID 重复": "Duplicate model ID",
  模型档案不存在: "The model profile does not exist",
  版本无效: "The version is invalid",
  版本不存在: "The version does not exist",
  "近期原文条数应在 10–500 之间":
    "Recent raw messages must be between 10 and 500",
  上下文压缩开关无效: "The context compression switch is invalid",
  最大聚合时间不能小于基础窗口:
    "The maximum batching time cannot be shorter than the base window",
  节能看图开关无效: "The image-saving switch is invalid",
  开关无效: "The switch is invalid",
  视觉兼容模型必须开启视觉能力:
    "A vision-compatible model must have vision turned on",
  备用模型无效: "The backup model is invalid",
  请从模型库中选择具体的备用模型:
    "Pick a specific backup model from the model library",
  备用模型不能和主模型相同:
    "The backup model cannot be the same as the main model",
  日志不存在: "The log does not exist",
  已有回放正在运行: "A replay is already running",
  回放消息序号范围无效: "The replay message range is invalid",
  "请选择 1–100 条人类消息": "Choose 1–100 human messages",
  请先开启模拟模式: "Turn on simulation mode first",
  "请选择会话并输入消息和有效的用户 ID":
    "Choose a session and enter a message and a valid user ID",

  // core
  "输入预算太小，无法容纳语境与人格":
    "The input budget is too small to hold the context and persona",
  "当前消息批次和引用链超过预算，请增加模型输入预算":
    "The current message batch and quote chain exceed the budget. Raise the model input budget.",
  语境摘要格式无效: "The context summary format is invalid",
  "API 地址无效": "The API URL is invalid",
  模型名称必填: "The model name is required",
  "模型尚未配置 API Key": "The model has no API key yet",
  输入与输出预算之和不能超过上下文窗口:
    "Input plus output budget cannot exceed the context window",
  采样参数无效: "The sampling parameters are invalid",
  "模型输出被截断，请增加输出预算":
    "The model output was cut off. Raise the output budget.",
  向量接口返回数量与输入不一致:
    "The vector API returned a different count than the input",
  向量接口返回重复或无效的输入编号:
    "The vector API returned duplicate or invalid input indexes",
  "向量接口未返回 embedding": "The vector API returned no embedding",
  向量接口返回无效数值: "The vector API returned invalid numbers",
  "请先在「系统 → 连接 QQ」填写 AppID":
    "Enter the AppID under System → Connect QQ first",
  "请填写有效的群 openid / 用户 openid 和名称":
    "Enter a valid group openid / user openid and a name",
  "请填写有效的群号/QQ号和名称":
    "Enter a valid group number / QQ number and a name",
  会话名称无效: "The session name is invalid",
  "回合输出不是 JSON 对象": "The turn output is not a JSON object",
  "回合输出缺少 choice": "The turn output has no choice",

  // model calls (shown in the call log)
  "当前批次、引用与人格超过模型输入预算，请增加 Max Input Tokens":
    "The current batch, quotes and persona exceed the model's input budget. Raise Max Input Tokens.",
  "模型 API HTTP 402：账户余额或额度不足，请在供应商后台检查或切换模型":
    "Model API HTTP 402: the account balance or quota is not enough. Check the provider's console or switch models.",
  "临时网络连接中断，等待后重试":
    "The network connection dropped briefly; waiting to retry",
  "尚未配置模型，请先在模型库中添加":
    "No model is configured yet. Add one in the model library first.",
  所选模型档案不存在: "The chosen model profile does not exist",
  "服务返回空正文，重试一次":
    "The service returned an empty body; retrying once",
  "输出达到本阶段上限，放宽到模型输出上限重试一次":
    "The output hit this stage's limit; retrying once with the model's full output limit",
  错误: "error",

  // vision
  图片地址不可访问: "The image address cannot be reached",
  图片下载失败: "The image download failed",
  图片超过大小限制: "The image is over the size limit",
  图片下载超时: "The image download timed out",
  图片跳转无效: "The image redirect is invalid",
  图片跳转过多: "Too many image redirects",
  图片读取失败: "The image could not be read",
  本地图片不存在: "The local image does not exist",
  本地图片无法读取: "The local image could not be read",
  不是支持的图片格式: "This image format is not supported",

  // database-archive.js
  "数据库来自更新版本，请先升级 LuckyTri；未修改数据":
    "The database comes from a newer version. Upgrade LuckyTri first; nothing was changed.",
  数据库完整性检查失败: "The database integrity check failed",
  数据库引用检查失败: "The database reference check failed",
  "这不是 LuckyTri 数据库": "This is not a LuckyTri database",
  备份校验清单不匹配: "The backup checksum list does not match",
  "恢复目标或伴随文件已存在，请选一个新文件；未覆盖任何数据":
    "The restore target or its companion file already exists. Choose a new file; nothing was overwritten.",
  恢复目标已被其他进程创建: "The restore target was created by another process",
  "数据库版本较新，请升级 LuckyTri；未修改数据":
    "The database version is newer. Upgrade LuckyTri; nothing was changed.",
  "绑定外网地址前必须设置 ADMIN_TOKEN":
    "ADMIN_TOKEN must be set before binding to a public address",

  // knowledge
  知识向量未启用: "Knowledge vectors are not enabled",
  "请选择会话、用户 ID 并填写记忆":
    "Choose a session and user ID, and enter the memory",
  请选择会话: "Choose a session",
  记忆内容无效: "The memory content is invalid",
  记忆状态无效: "The memory state is invalid",
  "置信度与重要性应在0–1": "Confidence and importance must be 0–1",
  过期时间无效: "The expiry time is invalid",
  锁定状态无效: "The lock state is invalid",
  选择两条记忆并输入合并内容: "Choose two memories and enter the merged text",
  只能合并同范围同用户的未锁定记忆:
    "Only unlocked memories of the same scope and user can be merged",
  "请输入 1–4000 字检索内容": "Enter 1–4000 characters to search",
  向量开关无效: "The vector switch is invalid",
  密钥格式无效: "The key format is invalid",
  "向量 API 地址无效": "The vector API URL is invalid",
  启用向量需要独立地址和模型名:
    "Enabling vectors needs a separate URL and model name",
  向量数量与输入不一致: "The vector count does not match the input",
  向量内容无效: "The vector content is invalid",
  向量维度不一致: "The vector dimensions are inconsistent",
  知识库名称无效: "The collection name is invalid",
  知识库不存在: "The collection does not exist",
  "文档内容应为 1–400000 字": "The document must be 1–400000 characters",
  文档切分后为空: "The document is empty after splitting",
  文档没有可建立向量的段落: "The document has no passages to vectorize",
  请先启用知识向量模型: "Enable the knowledge vector model first",
  "文档已变化，请重新建立向量": "The document changed. Rebuild its vectors.",
  文档不存在: "The document does not exist",

  // mind
  类型无效: "The type is invalid",
  内容无效: "The content is invalid",
  缺少来源: "A source is missing",
  日期无效: "The date is invalid",
  日期不在合理范围: "The date is outside a sensible range",
  与撤销过的内容相同: "Same as something already undone",
  约定不存在: "The promise does not exist",
  "TA 还不认识这个人": "TA does not know this person yet",
  在天性页修改: "Change it on the Nature page",
  "TA 正在想别的事": "TA is thinking about something else",
  请选择要撤销的内容: "Choose what to undo",
  "请输入 1–1000 字的试聊内容": "Enter 1–1000 characters for the trial chat",
  "正在试聊，请稍等": "A trial chat is running. Please wait.",
  试聊失败: "The trial chat failed",
  "每日 Token 上限无效": "The daily token limit is invalid",
  "预算份额应在 0–0.9": "Budget shares must be 0–0.9",
  "后台份额之和不能超过 95%":
    "Background shares cannot add up to more than 95%",
  需要选定有效的开始时间: "A valid start time is needed",
  "需要选定 5 至 240 分钟的投入时间": "A time of 5 to 240 minutes is needed",
  "所选开始时间在睡眠安排中，需要重新选择":
    "The chosen start time falls in her sleep schedule; choose again",
  安排包含无效内容: "The plan contains invalid content",
  需要把行动内容想具体: "The action needs to be thought through",
  需要自己选定要玩的游戏: "She needs to choose the game to play herself",
  没有得到明确的时间安排: "No clear time plan was given",
  空内容: "Empty content",
  疑似凭据: "Looks like a credential",
  不能把私下说法写进群里的面貌:
    "Private remarks cannot be written into a face used in a group",
  来源不能带到这个会话: "The source cannot be carried into this session",
  没有新的经历: "No new experience",
  没有变化: "No change",
  线索不存在: "The strand does not exist",
  面貌版本不存在: "The face version does not exist",
  关系变化不存在: "The relationship change does not exist",
  相遇不存在: "The encounter does not exist",
  不能撤销这类内容: "This kind of content cannot be undone",
  日记格式无效: "The diary format is invalid",
  回顾格式无效: "The reflection format is invalid",
  未保存: "Not saved",
  身份回看输出格式无效: "The self-review output format is invalid",
  记忆不存在: "The memory does not exist",
  允许复述时也必须允许想起:
    "If repeating is allowed, recalling must be allowed too",
  授权到期时间无效: "The authorization expiry is invalid",
  分寸标签无效: "The discretion label is invalid",
  "记忆已锁定，请先解锁": "The memory is locked. Unlock it first.",
  请选择要删除的记忆: "Choose the memories to delete",
  "请选择 1–500 条记忆": "Choose 1–500 memories",
  "全选删除不需要传入记忆 ID": "Select-all deletion does not take memory IDs",
  只能删除当前会话中存在的记忆:
    "Only memories that exist in the current session can be deleted",
  "只能删除当前会话的记忆，共享或继承记忆请单独管理":
    "Only this session's memories can be deleted; manage shared or inherited memories separately",
  "包含已锁定记忆，请先解锁后再删除":
    "Contains locked memories. Unlock them before deleting.",
  记忆整理格式无效: "The memory sorting format is invalid",
  名字无效: "The name is invalid",
  性别无效: "The gender is invalid",
  天性正文无效: "The nature text is invalid",
  列表字段必须是文本列表: "List fields must be lists of text",
  "性格刻度应在 0–100": "Character scales must be 0–100",
  表达字段无效: "The expression field is invalid",
  作息时间无效: "The daily rhythm time is invalid",
  "天性只能改两次。用完之后，由 TA 自己从经历里生长。":
    "Nature can be changed only twice. After that, TA grows from her own experience.",
  自己的安排格式无效: "Her own plan format is invalid",
  愿望未保存: "The wish was not saved",
  "自己的念头含有无效来源或敏感内容，未保存":
    "Her thought has an invalid source or sensitive content and was not saved",
  "没有玩过的经历，不能写成她的样子":
    "What she has not played cannot be written into who she is",
  来源不在本次经历中: "The source is not part of this experience",
  线索不存在或已撤销: "The strand does not exist or was undone",
  对不上她说过的话: "Does not match what she said",
  手记不存在: "The note does not exist",
  状态无效: "The status is invalid",
  "这条手记有后续修正，请隐藏以保留轨迹":
    "This note has later corrections. Hide it to keep the trail.",
  搜索提供方无效: "The search provider is invalid",
  作品不存在: "The work does not exist",
  "开始时间格式应为 YYYY-MM-DD HH:mm":
    "The start time must be in YYYY-MM-DD HH:mm format",
  约定回看格式无效: "The promise review format is invalid",
  活动成果格式无效: "The activity result format is invalid",
  时间设置超出范围: "The time settings are out of range",
  "活动速度应在 1 至 2 之间": "Activity speed must be between 1 and 2",
  任务已变化: "The task has changed",
  完成需要实际成果: "Completing needs an actual result",
  完成需要已提交的实际成果: "Completing needs a submitted result",
  等待可用模型: "Waiting for an available model",
  今日独处预算不足: "Not enough budget for time alone today",
  "实例已停止，资料结果未提交":
    "The instance stopped; the material result was not submitted",
  搜索配置格式无效: "The search settings format is invalid",
  搜索地址无效: "The search URL is invalid",
  查询用途无效: "The query purpose is invalid",
  查询只能包含资料主题: "A query may only contain the material topic",
  "搜索接口未返回有效 JSON，请核对提供方与完整搜索地址":
    "The search API did not return valid JSON. Check the provider and the full search URL.",
  "任务已经变化，资料结果未提交":
    "The task changed; the material result was not submitted",
  "正在测试搜索连接，请稍后":
    "A search connection test is running. Please try again shortly.",
  "正在推进活动步骤，请稍后测试":
    "An activity step is in progress. Test again shortly.",
  只有真实完成稿可以交付: "Only a genuinely finished piece can be delivered",
  正文包含其他会话的私下内容:
    "The text contains private content from another session",
  作品来源不允许在此会话分享:
    "The work's source does not allow sharing in this session",
  需要明确分享选择: "A clear sharing choice is needed",
  成果整理格式无效: "The result-sorting format is invalid",
  汇报涉及私下内容: "The report touches private content",
  需要几句自然汇报: "A few natural sentences of report are needed",
  汇报需要简短的一句一句说:
    "The report needs to be said in short, separate sentences",
  汇报包含不适合公开的信息:
    "The report contains information not suitable to share",
  "请回看后整理，不要复制正文": "Review and rephrase it; do not copy the text",
  没有可整理的任务: "No tasks to sort out",
  "任务目标或权限范围不同，不能合并":
    "Tasks with different goals or permission scopes cannot be merged",
  已有成果的任务不能改成未执行:
    "A task that already has results cannot be reset to not run",
  任务内容无效: "The task content is invalid",
  缺少真实来源: "A real source is missing",
  优先级无效: "The priority is invalid",
  "事项已变化，不能覆盖安排":
    "The item changed and the plan cannot be overwritten",
  时间安排无效: "The time plan is invalid",
  "所选时间与已有安排重叠，需要重新选定":
    "The chosen time overlaps an existing plan; choose again",
  事项已变化: "The item has changed",
  任务不存在: "The task does not exist",
  "这条记录已合并，请调整唯一任务":
    "This record was merged; adjust the single task instead",
  任务已经结束: "The task has already ended",
  不能直接标记完成: "It cannot be marked done directly",
  "投入时间应为 5 至 240 分钟": "The time to spend must be 5 to 240 minutes",
  任务租约已经改变: "The task lease has changed",
  作品正文格式无效: "The work text format is invalid",
  "单篇过长，请接续新篇章": "This piece is too long; continue in a new piece",
  活动草稿已不可用: "The activity draft is no longer available",
  项目不存在: "The project does not exist",
  建议类型无效: "The suggestion type is invalid",
  不适合长期自述或含私下内容:
    "Not suitable as a lasting self-description, or contains private content",
  缺少亲历来源: "A first-hand source is missing",
  自述需要模型之外的新经历:
    "A self-description needs new experience beyond the model",
  没有实质变化: "No substantial change",
  没有新的亲历来源: "No new first-hand source",
  未知性格维度: "Unknown character dimension",
  没有方向: "No direction",
  缺少可用的理由: "No usable reason was given",
  性格变化需要模型之外的经历:
    "A character change needs experience beyond the model",
  这段经历已经改变过它: "This experience has already changed it",
  "今天这项性格已经改变过，留些时间检验":
    "This trait already changed today; give it time to settle",
  已到边界: "Already at the limit",

  // studio
  反馈类型无效: "The feedback type is invalid",
  只能评价已发送的回复: "Only replies that were sent can be rated",
  "模型 ID 无效": "The model ID is invalid",
  找不到这个已保存的模型: "That saved model was not found",
  连接测试正在进行: "A connection test is already running",
  "请先配置模型 API Key": "Set the model API key first",
  "接口已响应，但 JSON 输出不符合预期":
    "The API responded, but its JSON output was not as expected",
  文本配置无效: "The text setting is invalid",
  接入方式无效: "The connection method is invalid",
  "接入方式已由环境变量 LUCKYTRI_CHANNEL 固定":
    "The connection method is fixed by the LUCKYTRI_CHANNEL environment variable",
  "AppID 格式无效": "The AppID format is invalid",
  "AppSecret 格式无效": "The AppSecret format is invalid",
  开关配置无效: "The switch setting is invalid",
  数值配置超出范围: "A numeric setting is out of range",
  模型服务商预设无效: "The model provider preset is invalid",
  思考强度无效: "The thinking effort is invalid",
  模型名称不能为空: "The model name cannot be empty",
};

// Messages that carry a value. `{0}`, `{1}` are filled with what the code put
// in; the values are passed through the dictionaries again.
export const ERROR_PATTERNS = [
  ["{0} Prompt 无效", "{0} prompt is invalid"],
  ["模型请求失败 HTTP {0}：{1}", "The model request failed with HTTP {0}: {1}"],
  ["模型请求失败 HTTP {0}", "The model request failed with HTTP {0}"],
  [
    "模型响应超时（{0} 秒内没有返回）",
    "The model did not respond within {0} seconds",
  ],
  [
    "模型服务网络连接失败（{0}，已自动重试）",
    "The connection to the model service failed ({0}); it was retried automatically",
  ],
  [
    "这个模型服务连续失败，已暂停请求，约 {0} 秒后自动恢复",
    "This model service failed repeatedly and is paused; it resumes automatically in about {0} seconds",
  ],
  [
    "主模型 {0} 请求失败（{1}），这一步改用备用模型 {2}",
    "The main model {0} failed ({1}); this step uses the backup model {2}",
  ],
  [
    "模型服务暂时返回 HTTP {0}，等待后重试",
    "The model service returned HTTP {0} for now; waiting to retry",
  ],
  [
    "模型输出不是有效 JSON，重试一次：{0}",
    "The model output was not valid JSON; retrying once: {0}",
  ],
  ["{0} 超出范围", "{0} is out of range"],
  ["{0} 必须是正整数", "{0} must be a positive integer"],
  ["{0} 必须是开关", "{0} must be a switch"],
  [
    "QQ 开放平台关闭了连接（{0}），请检查机器人状态与权限",
    "The QQ Open Platform closed the connection ({0}). Check the bot's status and permissions.",
  ],
  ["向量接口失败 HTTP {0}", "The vector API failed with HTTP {0}"],
  ["图片下载失败 HTTP {0}", "The image download failed with HTTP {0}"],
  ["搜索接口 HTTP {0}：{1}", "Search API HTTP {0}: {1}"],
  [
    "这些设置已经不存在：{0}。名字和天性在「TA → 天性」里修改",
    "These settings no longer exist: {0}. Change the name and nature under TA → Nature.",
  ],
  [
    "搜索连接失败（{0}），请检查网络和代理；代理状态改变后可重启实例",
    "The search connection failed ({0}). Check the network and proxy; restart the instance after the proxy changes.",
  ],
];
