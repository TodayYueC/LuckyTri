# LuckyBot

一个从 QQ 群聊起步的 AI 伙伴。她在本机理解多人对话，自己决定什么时候接话、什么时候安静，通过长期记忆和自己的日子记住人与事，也会重新审视过去的想法。

当前接入是 OneBot 11。QQ 登录和收发由 [NapCat](https://napneko.github.io/) 完成，LuckyBot 不保存 QQ 密码。模型使用兼容 Chat Completions 的接口。

**语言：** [简体中文](README.md) · [English](README.en.md)

## 一个她

所有群聊和私聊里只有一个她。你写下她的天性；自我、在各群的样子、对每个人的感觉都从经历里长出来，每一次变化都有来源，你可以看、可以撤销，但不替她改写。[设计与使用说明](docs/她的一生.md)。

- **由心开口**。没有参与概率和冷却。她细看一段对话时，先理解这对她意味着什么，再选择说、简短反应、说不想聊或不出声，并留下理由；沉默时心情和对人的感觉照样会变。
- **注意力**。被叫到、私聊、危机一定细看；普通群聊只在她在意时细看，其余扫一眼、不花 Token，未读的消息下次一起读。
- **一个人就是一个人**。同一个 QQ 号在所有群里是同一个人。记忆只有一份：别处知道的事只在相关时想起，私下知道的不当众说，被要求保密的不离开原处。
- **她的日子**。会睡觉（被叫到会等醒来再看，危机除外），安静时独处，睡前写日记并和昨天的自己对照，夜里把当天的事整理进记忆、隔一段时间回顾并改写自传或翻开新的一章，也可能想起某个人而主动说一句——说不说由她决定。
- **时间的重量**。很久没被触及的线索、手记和记忆会从心上淡去，被聊到时又想起（淡出按她经历过的日子算，安静的一个月不会让她忘了自己）；久别的人会变淡，重逢时很快热络；她记得别人说过的安排和自己答应的事，临近时会问一句，错过了也知道。
- **Token 有数**。一次调用同时完成理解、感受和措辞；每次调用按对话、独处、整理记账；可设每日上限与后台份额，快用完时她只在被叫到时细看。
- 短时间内的连续消息会合成一批；文档可以放进知识库；回放不发 QQ、不写心智，并且只读取当时之前的她。

## 环境

- Windows、macOS 或 Linux
- Node.js 24 或更高版本
- npm
- 真实回复需要模型 API Key
- 真实 QQ 需要 NapCat，建议使用专用小号

## 启动

```bash
git clone https://github.com/TodayYueC/LuckyBot.git
cd LuckyBot
npm install
npm run setup
npm start
```

打开 <http://127.0.0.1:3210>。Windows 也可以双击 `启动LuckyBot.cmd` 启动并打开 LuckyBot，双击 `停止LuckyBot.cmd` 停止本项目服务。

`npm run setup` 会在没有 `.env` 时生成管理令牌和 OneBot 令牌。文件已存在时不会覆盖。

```dotenv
HOST=127.0.0.1
PORT=3210
ADMIN_TOKEN=
ONEBOT_TOKEN=
LLM_API_KEY=
```

`ADMIN_TOKEN` 保护 LuckyBot 和 HTTP API。`ONEBOT_TOKEN` 保护 `/onebot/v11/ws`。`LLM_API_KEY` 可选，非空时优先于 LuckyBot 里保存的密钥。修改 `.env` 后需要重启。不要把真实密钥写入仓库、Issue 或截图。

默认是模拟模式。先在「对话 → 会话设置」添加群号或 QQ 号，再到「现场」发送模拟消息。模拟消息不发到 QQ；没有 API Key 时使用本地样例，不调用模型。

## 接入 QQ

1. 在「系统 → QQ 连接」使用内置安装器，或选择已有 NapCat 目录。
2. 生成连接配置并启动 NapCat，在 NapCat 窗口完成 QQ 登录。
3. 在「系统 → 模型」填写 API 地址、模型名称和密钥，测试连接。
4. 在「今日」关闭模拟模式并保存，确认全局参与已开启。
5. 在「会话设置」打开目标群或私聊的参与开关。

手动配置时，NapCat 使用反向 WebSocket 客户端：

```text
ws://127.0.0.1:3210/onebot/v11/ws
```

协议为 OneBot 11，消息格式为数组，Token 使用 `ONEBOT_TOKEN`。端口以 `.env` 中的 `PORT` 为准。

## 界面

| 入口 | 页面 | 用途 |
| --- | --- | --- |
| 今日 | `#overview` | 连接状态、参与中的会话、最近决策、全局开关和模拟模式 |
| 对话 | `#live` | 实时消息、本轮决策、引用的知识和模拟试聊 |
| 对话 | `#spaces` | 添加、暂停、移出和删除会话，设置模型、视觉、聚合、上下文和字数 |
| 对话 | `#lab` | 按消息序号隔离回放 |
| 她 | `#her` | 此刻、自我、关系、一生、天性；走真实链路的试聊 |
| 记忆 | `#knowledge` | 她记得的事（来源、分寸、撤销）、文档集合和检索测试 |
| 系统 | `#models` | 模型档案、预算、视觉、Embedding 和连接测试 |
| 系统 | `#connect` | NapCat 安装、配置、启动和就绪检查 |

修改界面配置后，下一轮对话生效。关闭浏览器不会停止服务。

## 数据

默认只监听 `127.0.0.1`。运行数据在 `data/`，不进入 Git：

```text
data/friend.db    消息、记忆、知识和本地配置
data/backups/     npm run backup 生成的数据库备份
data/*.log        启动和服务日志
```

数据库可能包含聊天原文和模型密钥。备份同样是私密文件，`.env` 不在数据库备份里。恢复前先停止服务，移走当前 `friend.db` 及其 `-wal`、`-shm`，再把备份复制为 `data/friend.db`。若设置了 `DB_PATH`，操作该路径。

绑定非本机地址前必须设置 `ADMIN_TOKEN`。安全处理见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm run dev:ui       # 界面热更新，API 代理到 3210
npm run build:ui     # 构建到 public/app，npm start 直接托管
npm test             # 服务端测试，含三天的确定性「一生模拟」
npm run test:ui      # 界面冒烟测试与「她」工作台浏览器测试
node scripts/evaluate-life.js   # 用真实模型过几天，输出报告供阅读（消耗 Token）
npm run format:check
npm run docs:build   # 由 docs/使用教程.md 生成网页教程
```

测试使用临时数据库，不需要真实密钥，也不向 QQ 发送消息。

```text
server/index.js      启动、鉴权和接线
server/channels/     会话身份、OneBot 适配和 WebSocket
server/core/         感知、语境、一次回合调用、校验和发送
server/mind/         她的心智：天性、心境、关系、自我、面貌、记忆、注意力、底线、Token 账本、一生
server/knowledge/    文档和检索
server/studio/       设置、NapCat 和模型探测的 HTTP 接口
studio-web/          Vue 3 界面源码
public/app/          构建后的界面
scripts/             启动、停止、备份和教程生成
tests/               服务端和界面测试
vendor/napcat/       经过校验的 NapCat Windows 包
```

## 文档

- [她的一生：统一心智的设计与使用](docs/她的一生.md)
- [使用教程](docs/使用教程.md)
- [安全说明](SECURITY.md)

## 许可

项目代码使用 [MIT License](LICENSE)。`vendor/napcat/` 中的 NapCat 发布包遵循其上游许可。
