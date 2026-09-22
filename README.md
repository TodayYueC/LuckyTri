# LuckyBot

本地优先的 QQ 群友。它在本机接收群聊和私聊，先判断该不该说话，再根据当前批次、引用链、人格、记忆和知识库生成回复。

当前接入是 OneBot 11。QQ 登录和收发由 [NapCat](https://napneko.github.io/) 完成，LuckyBot 不保存 QQ 密码。模型使用兼容 Chat Completions 的接口。

**语言：** [简体中文](README.md) · [English](README.en.md)

## 它做什么

- 私聊、@、点名和引用自己时直接回应；普通群聊先判断语境，再按参与概率决定是否插话。
- 短时间内的连续消息会合成一批再处理，避免只看见第一句。
- 长期记忆按会话、私聊和共享范围隔离。明确的「记住……」会先成为候选，审核后才进入回复。
- 文档可以放进知识库，检索结果只作为数据包进入语境，不会绕过发言决策。
- 工作室用于查看现场、调整会话、人格、模型和 QQ 连接，并回放历史消息。回放不发 QQ、不写生产记忆。

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

打开 <http://127.0.0.1:3210>。Windows 也可以双击 `启动LuckyBot.cmd` 启动并打开工作室，双击 `停止LuckyBot.cmd` 停止本项目服务。

`npm run setup` 会在没有 `.env` 时生成管理令牌和 OneBot 令牌。文件已存在时不会覆盖。

```dotenv
HOST=127.0.0.1
PORT=3210
ADMIN_TOKEN=
ONEBOT_TOKEN=
LLM_API_KEY=
```

`ADMIN_TOKEN` 保护工作室和 HTTP API。`ONEBOT_TOKEN` 保护 `/onebot/v11/ws`。`LLM_API_KEY` 可选，非空时优先于工作室里保存的密钥。修改 `.env` 后需要重启。不要把真实密钥写入仓库、Issue 或截图。

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

## 工作室

| 入口 | 页面 | 用途 |
| --- | --- | --- |
| 今日 | `#overview` | 连接状态、参与中的会话、最近决策、全局开关和模拟模式 |
| 对话 | `#live` | 实时消息、本轮决策、引用的知识和模拟试聊 |
| 对话 | `#spaces` | 添加、暂停、移出和删除会话，设置模型、概率、冷却和聚合 |
| 对话 | `#lab` | 按消息序号隔离回放 |
| 记忆 | `#knowledge` | 会话记忆、待审核候选、文档集合和检索测试 |
| 人格 | `#character` | 人格、口吻和 Prompt，以及隔离试聊 |
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
npm run dev:ui       # 工作室热更新，API 代理到 3210
npm run build:ui     # 构建到 public/app，npm start 直接托管
npm test             # 服务端测试
npm run test:ui      # 工作室冒烟测试
npm run format:check
npm run docs:build   # 由 docs/使用教程.md 生成网页教程
```

测试使用临时数据库，不需要真实密钥，也不向 QQ 发送消息。

```text
server/index.js      启动、鉴权和接线
server/channels/     会话身份、OneBot 适配和 WebSocket
server/core/         语境装配、发言决策、生成和发送
server/knowledge/    记忆、文档和检索
server/studio/       设置、NapCat 和模型探测的 HTTP 接口
studio-web/          Vue 3 工作室源码
public/app/          构建后的工作室
scripts/             启动、停止、备份和教程生成
tests/               服务端和界面测试
vendor/napcat/       经过校验的 NapCat Windows 包
```

## 文档

- [使用教程](docs/使用教程.md)
- [安全说明](SECURITY.md)

## 许可

项目代码使用 [MIT License](LICENSE)。`vendor/napcat/` 中的 NapCat 发布包遵循其上游许可。
