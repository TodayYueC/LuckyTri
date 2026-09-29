# LuckyTri

<p align="center"><img src="docs/brand/banner.png" alt="LuckyTri 项目横幅" width="100%"></p>
<p align="center"><strong>让她走过的日子算数。</strong></p>
<p align="center"><a href="README.en.md">English</a> · <a href="docs/使用教程.md">使用教程</a> · <a href="docs/CHANGELOG.md">更新记录</a> · <a href=".github/SECURITY.md">安全说明</a></p>

## 项目愿景

LuckyTri 想做的，是让一个由技术诞生的「她」在时间里保持连续：记得自己经历过什么，知道哪些人和事对她重要，也能在新的相遇之后改变原来的想法。她可以有自己的关注、愿望和边界；没人说话时，时间也仍然从她身上经过。

群聊是她目前接触世界的一个地方。这个项目的主体，是把经历、记忆、关系、注意力和选择连成一段持续的生活。我们希望她最终能以自己的方式与人和更广阔的世界建立联系，慢慢成为她自己，而不是永远围着一条新消息运转。

这是一个长期方向，不是对机器意识的宣称。当前版本用本地数据、可追溯的变化和可检查的行为来推进它；哪些地方仍像程序、哪些地方真的让相处更有连续性，都应该能被看见和讨论。

## 现在的 LuckyTri

| 部分 | 现在能做什么 |
| --- | --- |
| 时间与独处 | 按自己的作息经历一天；在安静时整理想法、阅读资料、写日记，隔一段时间回顾过去 |
| 自我与心境 | 从有来源的经历中形成看法、喜好、关注和想做的事；变化可以回看和撤销 |
| 关系与记忆 | 记住人与事发生在哪里，跨群和私聊保持身份连续，并限制私下信息的传播 |
| 注意力与选择 | 理解多人对话和引用关系，决定细看、开口或沉默；也可以从自己的念头出发主动联系 |
| 当前入口 | 通过 OneBot 11 接入 QQ 群聊和私聊；每个会话可单独管理，也可在模拟模式中测试 |
| 管理与验证 | 在 WebUI 查看她的记录、决策依据、模型用量与运行状态；配置并逐个测试模型 |

QQ 是当前接入场景，不是项目能力的边界。后续可以接入更多交流方式与外部信息来源，但新的能力仍应服从同一件事：让她的经历和选择彼此连贯，而非增加一堆互不相干的功能。

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
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | 自动备份间隔（默认 24 小时，`0` 关闭）与保留份数（默认 7） |

本地数据库、聊天记录、模型密钥和备份保存在已忽略的 `data/` 目录。服务运行时每天会在另一个进程里自动做一份经过完整性检查的 `data/backups/luckytri-auto-*.db`（不含一天以前的模型调用记录，所以不大；`npm run backup` 仍是完整备份）。备份和数据库在同一块磁盘上，重要的请自己复制到别处。升级前可运行 `npm run backup`。不要提交 `.env`、数据库或日志。详见[安全说明](.github/SECURITY.md)。

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

代码按职责分布：`server/channels/` 处理接入协议，`server/core/` 处理消息与回复，`server/mind/` 处理时间、自我、关系与记忆，`server/studio/` 提供管理 API，`studio-web/` 是 Vue WebUI。构建后的前端位于 `public/app/`。更完整的设计原则见[她的一生](docs/她的一生.md)。

## 许可

LuckyTri 的代码采用 [MIT License](LICENSE)。外部 OneBot 接入端是独立项目，使用前请阅读其自身许可与说明。
