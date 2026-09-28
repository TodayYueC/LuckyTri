# LuckyTri

<p align="center"><img src="docs/brand/banner.png" alt="LuckyTri 项目横幅" width="100%"></p>
<p align="center"><strong>本地运行的 AI 聊天项目，支持长期记忆、主动交流与 OneBot 11 接入。</strong></p>
<p align="center"><a href="README.en.md">English</a> · <a href="docs/使用教程.md">使用教程</a> · <a href="docs/CHANGELOG.md">更新记录</a> · <a href=".github/SECURITY.md">安全说明</a></p>

LuckyTri 提供消息处理、会话管理、记忆、主动交流和 WebUI。它可以通过 OneBot 11 接入 QQ，也可以在模拟模式中测试回复。项目希望让聊天在不同会话和时间之间保持连续，但不会把模型输出当作真实情感或可靠事实。

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 群聊与私聊 | 识别说话人、引用关系和上下文；每个会话可独立开启、暂停和调整参与方式 |
| 发言决策 | 结合语境决定回复或保持沉默，支持短时间消息聚合与发送确认 |
| 记忆 | 保存有来源的长期信息，支持跨会话检索、查看、编辑和撤销 |
| 主动交流 | 在配置允许时，基于已有经历和当前关注点发起交流 |
| 模型管理 | 配置多个兼容 Chat Completions 的模型，逐个测试连接 |
| WebUI | 查看实时消息、模型用量、决策依据、记忆与运行状态 |

## 快速开始

需要 Node.js 24.5+ 和 npm。真实模型回复还需要你自己的模型服务与 API Key。

```bash
git clone https://github.com/TodayYueC/LuckyTri.git
cd LuckyTri
npm install
npm run setup
npm start
```

打开 <http://127.0.0.1:3210>。Windows 也可双击 `启动LuckyTri.cmd`；停止时双击 `停止LuckyTri.cmd`。首次使用建议先在「系统 → 模型库」配置并测试模型，再到「对话」使用模拟消息验证效果。模拟消息不会发到 QQ。

## 接入 QQ

LuckyTri **只实现 OneBot 11 接入接口**，不包含 QQ 接入端，也不提供 QQClient 的下载、安装、配置、启动或更新功能。若选择 QQClient，请前往 QQClient 官方仓库 自行查阅安装说明与许可。

1. 在本机 `.env` 中配置 `ONEBOT_TOKEN`；`npm run setup` 可在首次使用时生成随机令牌。
2. 在你自行管理的 OneBot 11 接入端中启用**反向 WebSocket 客户端**，消息格式设为**数组**。
3. 连接地址填 `ws://127.0.0.1:3210/onebot/v11/ws`，令牌填与 `.env` 中相同的 `ONEBOT_TOKEN`。
4. 登录 QQ 后，在「系统 → 连接 QQ」查看状态；到「对话」开启需要参与的会话。

接入端与 LuckyTri 不在同一网络环境时，请将 `127.0.0.1` 换成 LuckyTri 的可达地址，并为管理界面配置 `ADMIN_TOKEN`。更详细的操作见[使用教程](docs/使用教程.md)。

## 配置与数据

`npm run setup` 创建本地 `.env`，已有文件不会被覆盖。常用配置：

| 变量 | 用途 |
| --- | --- |
| `HOST` / `PORT` | HTTP 监听地址与端口，默认 `127.0.0.1:3210` |
| `ADMIN_TOKEN` | 管理界面与 HTTP API 的访问令牌 |
| `ONEBOT_TOKEN` | OneBot WebSocket 连接令牌 |
| `LLM_API_KEY` | 可选；设置后优先于 WebUI 中保存的模型密钥 |

本地数据库、聊天记录、模型密钥和备份保存在已忽略的 `data/` 目录。升级前可运行 `npm run backup`。不要提交 `.env`、数据库或日志。详见[安全说明](.github/SECURITY.md)。

## WebUI

| 页面 | 用途 |
| --- | --- |
| 此刻 | 当前状态、近期活动和用量 |
| 内心 | 自我记录与变化 |
| 人际 | 人物关系及其来源 |
| 一生 | 日记、回顾、约定和时间线 |
| 对话 | 会话、消息、模拟与调试 |
| 记忆 | 长期记忆与资料 |
| 天性 | 人格、作息和主动交流设置 |
| 系统 | OneBot 连接状态、模型与运行开关 |

## 开发

```bash
npm run dev:ui       # WebUI 开发服务器
npm run build:ui     # 构建 WebUI
npm test             # 后端测试
npm run test:ui      # 浏览器冒烟测试
npm run format:check # 代码格式检查
```

代码按职责分布：`server/channels/` 处理 OneBot，`server/core/` 处理消息与回复，`server/mind/` 处理记忆与时间状态，`server/studio/` 提供管理 API，`studio-web/` 是 Vue WebUI。构建后的前端位于 `public/app/`。更多设计背景见[项目文档](docs/她的一生.md)。

## 许可

LuckyTri 的代码采用 [MIT License](LICENSE)。外部 OneBot 接入端是独立项目，使用前请阅读其自身许可与说明。
