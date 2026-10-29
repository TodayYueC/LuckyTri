<p align="right"><b>中文</b> · <a href="../en/qq-official-bot.md">English</a></p>

# QQ 官方机器人：能力对照与实验接法

调查日期：2026-10-29。对照的是 QQ 开放平台当时公开的机器人文档，不是现有的 OneBot 接入。生产环境继续走 OneBot。这篇是 `offbot` 上的探路记录，不把官方接口说成已经能代替现有接入。

主要页面：

- [QQ Bot 介绍与接入指南](https://bot.qq.com/wiki/)（页面标注更新于 2026-10-21）
- [API 调用指南](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html)（统一地址 `https://api.bot.qq.com`）
- [事件订阅与通知](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)（页面标注更新于 2026-09-11）
- [消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)
- [发送消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)（页内仍印着 2025-04-21 主动推送下线公告，又写着 2026-01-10 的互动召回和 2026-03-05 的沙箱免频控）
- [发送单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)
- [群消息（全量）](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)
- [获取机器人群内状态](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)

同一份官方文档里，主动消息的额度互相打架。下面每个数字都标明出处。拿不准的，按更严的那条做实验。

## 先说结论

官方机器人**不能**承担 LuckyTri 现在靠 OneBot 接入做的事：随时主动找人、在群里旁听闲聊、稳定地发图片和语音、用 QQ 号把同一个人认成一个。

它**可以**做的最小实验是：控制台用 WebSocket，创建者自己把机器人加为好友或拉进自己当群主/管理员的群，对方先发一条文本，LuckyTri 在被动窗口内回一条纯文本。群窗口大约 5 分钟，单聊大约 60 分钟。窗口外的主动消息不要当成她还能自己开口。

默认通道仍是 OneBot。`LUCKYTRI_CHANNEL` 不设或设为 `onebot` 时，这条官方通路不会连出去。

## 鉴权

| 项目 | 现在的做法 |
| --- | --- |
| 凭据 | 开放平台的 AppID 与 AppSecret。LuckyTri 读 `QQBOT_APP_ID` / `QQBOT_APP_SECRET`，没有则用管理台里保存的。Secret 不回显。 |
| Access Token | `POST https://bots.qq.com/app/getAppAccessToken`，JSON：`appId`、`clientSecret`。返回 `access_token` 与 `expires_in`（常见 7200 秒，类型有时是字符串）。 |
| 调用头 | `Authorization: QQBot {access_token}`。不是 `Bearer`，也不是旧的 `Bot {token}`。 |
| 续期 | 过期前约 60 秒内新旧 token 都有效。LuckyTri 在剩余不足 90 秒时刷新，401 时作废缓存再要一次。 |
| OpenAPI | `https://api.bot.qq.com`。可用 `QQBOT_API_BASE` 改掉，留给实验；默认不改。 |
| IP 白名单 | 控制台可填最多 50 个单个 IPv4，不支持网段。留空则不限制。填了之后，只有名单里的地址能调 OpenAPI。名单漏了这台机器时，取 token、取网关、发消息都会失败，连接页应是错误而不是「已连接」。 |

沙箱：发送消息那一页写「沙箱环境内不受频控」。独立域名在新的 api-v2 指南里没有写死（旧资料常见 `https://sandbox.api.sgroup.qq.com`）。本分支不默认切沙箱。要试，只在实验实例上设 `QQBOT_API_BASE`，并看控制台当前说明。

## 事件怎么进来

控制台「事件订阅与回调地址」里，**WebSocket 与 Webhook 二选一，切换立刻生效**。一边选错，另一边就是静默：网关可以 READY，一条用户消息都不会来。

| | WebSocket（LuckyTri 默认） | Webhook（要自己打开） |
| --- | --- | --- |
| 谁连谁 | LuckyTri 去连 `GET /gateway` 返回的地址 | 平台 POST 到你的 HTTPS |
| 适合 | 没有公网入口的单机、实验 | 有固定 HTTPS 的服务 |
| 端口 | 出站即可 | 只允许 80、443、8080、8443 |
| 鉴权 | Identify：`token`、`intents`、`shard` | 回调地址验证 op=13；事件要验 `X-Signature-Ed25519` |
| 环境变量 | `QQBOT_TRANSPORT` 不设，或 `websocket` | `QQBOT_TRANSPORT=webhook`，路径默认 `/qqbot/webhook` |

WebSocket 流程：Hello（op 10，心跳间隔）→ Identify（op 2）→ READY（拿到 `session_id`）→ 按间隔心跳（op 1 / op 11）。断线后用 Resume（op 6）补事件。关闭码 4914、4915 视为机器人被下线或权限被拒，不再重试。

本分支订阅的 intent 只有 `GROUP_AND_C2C_EVENT`（`1 << 25`）。2026-09-11 的意图表里，这一位包含：

- `C2C_MESSAGE_CREATE` 单聊
- `GROUP_AT_MESSAGE_CREATE` 群里 @ 机器人
- `FRIEND_ADD` / `FRIEND_DEL`
- `C2C_MSG_REJECT` / `C2C_MSG_RECEIVE` 单聊主动消息开关
- `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT`
- `GROUP_MSG_REJECT` / `GROUP_MSG_RECEIVE` 群主动消息开关

`GROUP_MESSAGE_CREATE`（群全量）**不在**那张 9 月意图表里，但全量事件页写它用的也是 `1 << 25`，并且只有打开「接收所有消息」之后才会推。LuckyTri 已经会解析这个事件。没推送时，缺的是控制台/群资料上的接收设置，不是再订一个 intent。订了没有权限的 intent，WebSocket 会直接断开。所以这里故意不加频道、论坛、音频那些位。

频道（guild）事件是另一套：`AT_MESSAGE_CREATE`、`MESSAGE_CREATE`、`DIRECT_MESSAGE_CREATE`。LuckyTri 的官方通道不接频道。现有的 OneBot 接入也不靠频道。

身份：

- 单聊用户是 `user_openid`，群成员是 `member_openid`，群是 `group_openid`。
- 不同机器人拿到的 openid 不同。
- 同一个人在不同群的 `member_openid` 不同。`union_openid` 有值时，LuckyTri 才把他们收成同一个人。经常是空的。
- 平台不给群名。单聊昵称也经常空。会话可以在「对话」里改名。

群接收还有第三档。`GET /v2/groups/{group_openid}/bot_state` 的 `recv_msg_setting` 可以是 `all`、`only_mention`、`mention_and_context`。该接口文档写着非白名单机器人会得到 `11253`。本分支不调用它，只根据实际到达的事件判断：出现过非 @ 的 `GROUP_MESSAGE_CREATE` 就标「全部群消息」，只出现过 `GROUP_AT_MESSAGE_CREATE` 就标「只有 @」。

## 发出去的消息

发送地址：

- 单聊 `POST /v2/users/{user_openid}/messages`
- 群 `POST /v2/groups/{group_openid}/messages`

`msg_type`：0 文本（`content`），2 Markdown，3 Ark，4 embed，7 富媒体（先上传拿 `file_info`）。键盘走 `keyboard`。本分支**只发送 type 0**。Markdown、按钮、Ark、图片、语音、文件会在本地直接拒绝，并说明还是实验桩，避免把半截请求打到平台上。

被动回复要带事件里的 `d.id` 作为 `msg_id`，多条气泡用递增的 `msg_seq`。同一个 `msg_id + msg_seq` 再发会失败。平台可能把同一条消息推两次，去重按消息 id，回复序号在发出前就占掉，避免超时后重发同一序号。

| 场景 | 被动窗口 | 每条消息可回复次数 | 出处 |
| --- | --- | --- | --- |
| 群 | 5 分钟 | 5 次 | 概述页、发送消息页 |
| 单聊 | 60 分钟 | 概述页和自动生成的单聊接口写 **4** 次；发送消息页写 **5** 次 | 文档冲突。LuckyTri 按 4 次实现，和第 5 条起改走主动发送 |

窗口留了一点余量（群少 15 秒，单聊少 1 分钟）。过了窗口，或平台返回 msg_id 过期（如 `40034005`），现有逻辑会改发**不带 msg_id 的主动消息**。

主动消息是这份探路里最不能依赖的部分：

| 说法 | 出处 |
| --- | --- |
| 2025-04-21 起不再提供主动推送，调用会收到错误 | 发送消息页顶部公告，2026 年 10 月仍在 |
| 单聊、群聊主动消息每月各 4 条 | 同一页正文 |
| 单聊互动召回：对方先说过话之后 30 天内 4 个周期各 1 条，字段 `is_wakeup` | 2026-01-10 更新；与 `msg_id` 互斥 |
| 企业/个人认证单聊 10 QPS、每关系 20 条/分钟、每人每天 1000 条；未认证更低。群每天每群 1000 条 | 概述页、单聊自动生成接口。和「每月 4 条」「已经下线」不是一个数量级 |
| 用户或群管理可关掉「允许主动发送」，关掉后主动消息失败（LuckyTri 认 `40034105`） | 各发送页 |

实验时把 `QQBOT_PROACTIVE=passive`。这样窗口外 LuckyTri 自己拒绝，不会去撞那条可能已经下线的主动接口，也不会在错误码含糊时把同一句再打一遍。默认仍是 `auto`，和这条分支原来的行为一致：窗口外尝试主动发送，单聊被拒时每个周期试一次 `is_wakeup`。

富媒体要先上传（分片或整文件），`file_info` 有过期时间，单聊和群的上传不通用。接收方向的图片 URL 已经交给原来的视觉链路，并且只放行官方媒体域名。发出方向没有接上传。

链接：没在 q.qq.com 后台预先配置的 URL 会被拒。

## 谁能给机器人发消息

接入指南（2026-10-21）写的主体差异：

- 未认证：创建者只能把机器人加进自己是群主或管理员的群。
- 个人认证：不能公开使用，进群上限 500。
- 企业认证：场景可以公开。
- 历史上以个人主体走过旧平台公开审核的，可以公开，但进群数有限制。

单聊不是「建好机器人就会有人来聊」。对方要添加机器人或打开会话再发一条，才会有 `C2C_MESSAGE_CREATE`。只收到 `FRIEND_ADD` 时，LuckyTri 只记下主动消息开关一类的权限事件，不会凭空开聊。

群里默认是 @ 才推事件。没 @ 的闲聊，官方机器人听不见，她也就不会接话。这和 OneBot 接入能看到整群不一样。开了「接收所有消息」之后，事件会进核心；她仍按原来的注意力决定出不出声，群里忙别的话题时可以不回。所以「全量事件已经到了」也不等于「她会在群里水群」。

## 为什么经常是「连上了，却不说话」

按出现的频率：

1. **控制台是 Webhook，程序在听 WebSocket。** 网关 READY，`dispatchCount` 一直是 0，QQ 里没有任何会话。反过来也一样。切换立刻生效。
2. **机器人不在任何会话里。** 没进群，也没被加为好友。未认证时还进不了别人当群主的群。
3. **群只推 @。** 连接页群消息范围会变成「只有 @ 她的消息」。别人正常聊天时，她像不在。
4. **IP 白名单漏了出口地址。** 这种更常表现为连接失败或发送失败，而不是静默的 READY。白名单留空才是全放行。
5. **被动窗口过了才回。** 模型慢、她选择晚一点再说、或者一次回了太多气泡。群 5 分钟 / 5 条，单聊 60 分钟 / 4 条。之后的主动发送可能直接被平台拒绝。表现是「看到消息了，QQ 里没有回复」。连接状态里的 `lastSendError` 会留下平台或本地的原因。
6. **对方关掉了主动消息，或机器人被移出群、被禁言、内容没过审、带了未配置的链接。** 对应错误码在 `server/channels/qqbot/index.js` 的 `EXPLAIN` 里写成了人话。
7. **Token 没续上。** 正常路径会提前刷新。Secret 错时连接状态是错误，不会装成在线。
8. **她自己选择不回。** 和 OneBot 一样：全局或会话开关、休息、限速、模型失败、群里这句话没在叫她。官方通道只是让「没被叫到」更容易发生。

连接页的就绪检查在「网关已就绪但事件数为 0」时会直接写出第 1 条。状态里的 `hints` 是同一份判断。

## 能力矩阵

| LuckyTri 需要的 | OneBot 11 | QQ 官方机器人（2026-10） |
| --- | --- | --- |
| 私聊文本，对方先开口，窗口内回复 | 可以 | 可以。这是最小实验。 |
| 群里 @ 之后窗口内回复 | 可以 | 可以，约 5 分钟、5 条。 |
| 群里旁听、接闲聊 | 可以，看她的注意力 | 默认不行。全量开关开了之后事件能到，她仍可能不接。 |
| 她主动找人、隔天想起、分享作品 | 可以 | 不可靠。文档同时写着下线、每月 4 条、以及高很多的 QPS。不要用生产人设去试。 |
| 单聊召回 `is_wakeup` | 不需要 | 文档有，对方先聊过之后若干周期各 1 条。代码在主动发送被拒时会试一次。 |
| 图片、语音、文件 | 接入端收发 | 收：附件 URL 进视觉链路。发：未接上传，调用会被本地拒绝。 |
| Markdown、按钮、Ark | 视 OneBot 实现 | 平台有接口，本分支不发。 |
| 表情、戳一戳、撤回、音乐卡片 | OneBot 扩展，失败就不提供 | 官方通道没有这些动作。 |
| 群名、昵称、好友列表 | 有 | 没有可用的名册。群名要手改会话名。 |
| 同一个人跨群、跨私聊 | QQ 号 | 通常是不同 openid。没有 `union_openid` 就是不同的人。 |
| 频道 / 文字子频道 | 不走这条 | 平台有，LuckyTri 不接。 |
| 和现有 OneBot 接入同时挂在一个进程 | 现在就是这条 | 不行。`ChannelHub` 同一时间只开一个 QQ 通道。 |

## LuckyTri 里它接在哪

官方事件和 OneBot 事件进的是同一个中性消息，再进同一套注意力、记忆、关系、独处、日记和时间。

```
C2C_MESSAGE_CREATE
GROUP_AT_MESSAGE_CREATE  → normalize() → ChatSystem.receive(中性消息)
GROUP_MESSAGE_CREATE

她决定回复的文本 → channel.send()
  窗口内：POST .../messages  { msg_type:0, content, msg_id, msg_seq }
  窗口外：同一地址，不带 msg_id（QQBOT_PROACTIVE=passive 时改为本地拒绝）
```

会话键：

- `qqbot:<AppID>:private:<用户 openid 或 union_openid>`
- `qqbot:<AppID>:group:<群 openid>`

OneBot 是 `onebot:<账号>:<private|group>:<QQ 号>`。两边的键对不上，所以同一个人会变成记忆里的两个人。

配置：

| 变量 | 作用 |
| --- | --- |
| `LUCKYTRI_CHANNEL` | `onebot` 或 `qqbot`。设置后界面不能改。不设则用界面里的选择，默认 onebot。 |
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | 凭据，盖过界面里保存的。 |
| `QQBOT_TRANSPORT` | `websocket`（默认）或 `webhook`。必须和控制台一致。 |
| `QQBOT_WEBHOOK_PATH` | 默认 `/qqbot/webhook`。 |
| `QQBOT_PROACTIVE` | `auto`（默认）或 `passive`。 |
| `QQBOT_API_BASE` | 可选。默认 `https://api.bot.qq.com`。 |

代码在 `server/channels/qqbot/`：`credentials.js` 读配置，`api.js` 管 token 和发送，`gateway.js` 管 WebSocket，`webhook.js` 管回调验签，`adapter.js` 把事件收成中性消息，`index.js` 实现通道契约，`silence.js` 写静默原因。注册表仍是 `server/channels/adapters.js` 与 `server/channels/index.js`。核心没有为官方通道加分支。

## 不要和正在用的 OneBot 接入共用一份她

`ChannelHub` 不会让两个 QQ 通道同时在线。切换会断开当前连接；旧会话还能看，不能再发。

更危险的是开两个进程、指同一份 `data/friend.db`。记忆、关系和自我会写坏。官方 openid 和 QQ 号也不是同一个人的键。把实验接到生产人设上，她会把同一个真人认成陌生人，或者在两个出口抢着说话。

实验用单独的 `LUCKYTRI_HOME`（或单独的机器目录），单独的 AppID，不要指向上面那两台正在跑 OneBot 接入的 Lightsail。不要为了试官方接口去改生产上的 OneBot 地址。

## 本分支做了什么

已经有的：token 刷新、WebSocket 网关（心跳、Resume、退避）、群 @ / 群全量 / 单聊的解析和去重、被动窗口和序号、主动消息被关闭时的记录、`is_wakeup` 每周期一次。

这次加上的：

- 状态里的 `hints`、`dispatchCount`、`lastEventType`、`lastSendError`。就绪检查在「已连接但零事件」时说明 Webhook/WebSocket、进群和白名单。
- `QQBOT_TRANSPORT=webhook` 时挂上回调：op=13 的签名与官方示例向量一致，事件校验 `X-Signature-Ed25519`，回 `{ "op": 12, "d": 0 }`。默认不挂，OneBot 的 `/onebot/v11/ws` 不动。
- `QQBOT_PROACTIVE=passive`。
- 富媒体、Markdown、Ark、按钮的发送在本地拒绝。

没做的：媒体上传、频道、沙箱域名自动切换、主动消息的可靠策略、和管理台里的「接收方式」开关（接收方式只走环境变量，避免和正在用的 OneBot 界面缠在一起）。

## 最小实验

用一份空数据目录，不要用生产库。

1. 开放平台创建机器人，记下 AppID 和 AppSecret。主体至少先能让你自己把机器人加为好友，或拉进你当群主/管理员的一个小群。
2. 控制台事件接收选 **WebSocket**。IP 白名单要么留空，要么填上这台机器的出口 IPv4。服务范围里打开你要试的单聊或群。
3. `.env`：

```
LUCKYTRI_CHANNEL=qqbot
QQBOT_APP_ID=你的AppID
QQBOT_APP_SECRET=你的AppSecret
QQBOT_TRANSPORT=websocket
QQBOT_PROACTIVE=passive
```

4. 启动后看「系统 → 连接 QQ」。状态应为已连接，机器人名出现。此时 `最近事件` 仍可以是「还没有」。
5. 用你自己的 QQ 给机器人发一句「在吗」，或在测试群里 @ 它。几秒内应出现会话。她的回复必须落在窗口内，并且是纯文本。
6. 群里不 @、让别人闲聊。如果范围仍是「只有 @」，这是平台行为，开「接收所有消息」之前不要指望她水群。
7. 把上面这条私聊停过一小时再让她主动说话。`passive` 下她不会发。改回 `auto` 再试，失败就看 `lastSendError`，把 trace id 留在自己的笔记里。不要为了让她主动开口而改生产通道。

Webhook 只有在你已经有公网 HTTPS，并且控制台改成了 Webhook 时才设 `QQBOT_TRANSPORT=webhook`。回调地址形如 `https://你的域名/qqbot/webhook`，端口用 443。本地没有公网入口时，继续用 WebSocket。

做到第 5 步仍没有会话：看连接页就绪说明里的 `hints`，对照上面的静默清单。做到第 5 步有会话、窗口内有文本回复，才说明这条通路对你这个机器人是通的。那仍然不等于她能代替现有 OneBot 接入过日子。
