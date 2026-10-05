// Connect QQ, the readiness checklist and adding a chat.
export default {
  "连接 QQ": "Connect QQ",
  "两种连接方式二选一，同一时间只使用一种。她的记忆、心情和行为完全一致，区别只在消息怎么到达。":
    "Pick one of two ways to connect; only one is used at a time. Her memory, moods and behavior are the same either way. Only the way messages arrive differs.",
  "QQ 已连接": "QQ connected",
  等待连接: "Waiting for a connection",
  连接方式: "Connection method",
  使用中: "In use",
  改用这种方式: "Use this method",
  "已切换为 {name}": "Switched to {name}",
  切换连接方式: "Switch connection method",
  "切换后会断开当前连接。原来方式下的会话仍可查看，但不能再向它们发送消息。":
    "Switching drops the current connection. Chats from the previous method stay readable, but nothing can be sent into them.",
  切换: "Switch",
  先不切换: "Not now",
  "连接方式由环境变量 LUCKYTRI_CHANNEL 指定，在这里不能更改。去掉该变量后即可在此选择。":
    "The connection method is set by the LUCKYTRI_CHANNEL environment variable and cannot be changed here. Remove it to choose here.",
  "OneBot 11": "OneBot 11",
  "自备接入端，通过反向 WebSocket 连接。能看到全部群消息。":
    "Bring your own client and connect over a reverse WebSocket. Sees every group message.",
  "反向 WebSocket 地址": "Reverse WebSocket address",
  "同一台电脑上的接入端无需单独配置连接令牌。":
    "Clients on the same computer need no separate connection token.",
  "在接入端启用反向 WebSocket 客户端，填写上方地址，消息格式选择数组。已有的地址配置可以继续使用。":
    "Enable a reverse WebSocket client, use the address above, and choose array messages. Existing address settings can stay as they are.",
  "远程接入时，连接密码使用管理密码；已有的远程连接令牌仍兼容。":
    "Remote clients can use the management password. Existing remote access tokens remain supported.",
  "在接入端完成 QQ 登录。连接成功后，本页状态会更新；新会话仍需在「对话」中开启参与。":
    "Sign in to QQ in that client. This page updates once it connects; new chats still need to be switched on under Chats.",
  "LuckyTri 只负责接收，不提供、不安装也不管理接入端。":
    "LuckyTri only receives. It does not provide, install or manage the client.",
  "QQ 官方机器人": "QQ official bot",
  "只需 AppID 与 AppSecret，无需额外软件。群里默认只收到 @ 她的消息。":
    "Needs only an AppID and AppSecret, no extra software. In groups it receives only messages that @ her by default.",
  AppID: "AppID",
  "机器人的 AppID": "The bot's AppID",
  AppSecret: "AppSecret",
  "已保存，留空保留": "Saved, leave blank to keep",
  "机器人的 AppSecret": "The bot's AppSecret",
  "由环境变量指定，在这里不能修改":
    "Set by an environment variable and cannot be changed here",
  保存: "Save",
  保存并使用: "Save and use",
  已保存: "Saved",
  "请填写 AppID 和 AppSecret": "Enter both the AppID and the AppSecret",
  有尚未保存的修改: "Unsaved changes",
  连接状态: "Connection",
  机器人: "Bot",
  最近收到消息: "Last message received",
  还没有: "None yet",
  群消息范围: "Group messages",
  全部群消息: "All group messages",
  "只有 @ 她的消息": "Only messages that @ her",
  尚未收到群消息: "None received yet",
  未启用: "Not in use",
  "尚未填写 AppID 与 AppSecret": "AppID and AppSecret not entered yet",
  正在连接开放平台: "Connecting to the open platform",
  已连接: "Connected",
  "连接已断开，正在重连": "Disconnected, reconnecting",
  连接出错: "Connection error",
  "目前只收到 @ 她的群消息。想让她看到群里的全部消息，请在开放平台的机器人设置里开启「接收所有消息」。":
    "Only group messages that @ her have arrived so far. To let her see everything said in a group, turn on “Receive all messages” in the bot settings on the open platform.",
  "在 QQ 开放平台创建机器人，取得 AppID 与 AppSecret。":
    "Create a bot on the QQ open platform and get its AppID and AppSecret.",
  "把运行 LuckyTri 的这台机器的出口 IP 加入机器人的 IP 白名单。":
    "Add the outbound IP of the machine running LuckyTri to the bot's IP allowlist.",
  "可选：开启「接收所有消息」，她才能看到群里没有 @ 她的话；不开启时只会收到 @ 她的消息。":
    "Optional: turn on “Receive all messages” so she can see group talk that does not @ her. Without it she only receives messages that @ her.",
  "填写上方的 AppID 与 AppSecret 并保存。状态变为「已连接」后，在群里 @ 她或私聊她，新会话会出现在「对话」中。":
    "Enter the AppID and AppSecret above and save. Once the status says Connected, @ her in a group or message her privately, and the new chat appears under Chats.",
  "官方平台不提供群名称：新会话以占位名出现，可以在「对话」中为它改名。":
    "The official platform does not provide group names. New chats show a placeholder name that you can change under Chats.",
  "官方平台上，同一个人在不同的群里标识不同。像只在不同的房间见过对方一样，平台给出统一身份之前，她不会把两处的人当成同一个人。":
    "On the official platform the same person has a different ID in each group. As if she had only met them in separate rooms, she will not treat them as one person until the platform provides a unified identity.",
  "对方关闭了机器人的主动消息时，她不会去打扰，会等对方来找她。":
    "When someone has turned off the bot's proactive messages she will not intrude. She waits for them to come to her.",
  就绪检查: "Readiness",
  还差哪一步: "What is left",
  查看: "View",
  去处理: "Fix",
  // Adding a chat
  "添加群聊 / 私聊": "Add a group or private chat",
  "添加之后再决定要不要让 TA 参与；开不开口仍由 TA 自己决定。":
    "Add it first, then decide whether she takes part. Whether she speaks is still up to her.",
  类型: "Type",
  群聊: "Group",
  私聊: "Private",
  "群号 / QQ 号": "Group number / QQ number",
  "4–20 位数字": "4–20 digits",
  "群 openid / 用户 openid": "Group openid / user openid",
  "8–64 位字母、数字、下划线或短横线。官方平台的会话通常会在有人 @ 她或私聊她时自动出现，这里只用于提前登记。":
    "8–64 letters, digits, underscores or hyphens. On the official platform a chat usually appears by itself once someone @s her or messages her privately; this is only for adding one ahead of time.",
  显示名称: "Display name",
  添加会话: "Add chat",
  "请先在「连接 QQ」里填写机器人的 AppID":
    "Enter the bot's AppID under Connect QQ first",
  会话名称: "Chat name",
  "官方机器人平台不提供群名称，可以在这里自己起一个":
    "The official bot platform does not provide group names, so you can name it yourself here",
} as Record<string, string>;
