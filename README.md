# Lucky · QQ AI 群友

一个本地优先、可长期生活在 QQ 群里的 AI 群友项目。

它通过 OneBot 11 兼容的 QQ 接入框架接收群聊和私聊消息，再把“现在是不是该说话”与“具体应该怎么说”拆成独立决策。它不会把每条消息都当成对自己的提问，也不会用固定的客服话术维持存在感，而是尽量像一个真实群友：理解说话人和对象、记住重要的事、该安静时安静、被明确叫到时及时回应。

项目采用 Node.js、Express、SQLite 和原生 JavaScript WebUI，不需要前端构建。默认运行在本机回环地址，数据和密钥留在本地。

## 特性

- **群聊语境判断**：按消息 ID、发送者、时间、@目标、引用链、附件和当前话题保存事件，不把相邻消息简单拼成一段文字。
- **独立发言决策**：先判断 `SILENT / REPLY / REACT / MULTI_MESSAGE`，明确 @、叫名字、私聊或接续 Lucky 的话会提高优先级，普通旁听消息才走概率。
- **短时聚合**：连续消息在很短窗口内合并理解，减少 A 说一句、B 补一句而模型只看见第一句的问题。
- **长期记忆**：短期上下文、阶段摘要、长期事实分层保存；记忆带来源、置信度、重要性、范围、版本和锁定状态，不会每次整理时覆盖旧事实。
- **跨会话记忆边界**：同一 QQ 号的共享记忆可以跨群和私聊使用，仅私聊或指定会话的记忆不会泄露到其他场景。
- **稳定人设**：基础性格、兴趣、温柔/幽默/毒舌/主动程度分开配置；自然表达优先于人设表演，低毒舌不会被“随和”设置意外放大。
- **自然回复节奏**：回复生成后有独立发送延迟和冷却，偶尔支持 2～3 个气泡，但不会为了模拟真人强行拆句。
- **图片与表情边界**：图片和对应文字一起进入语境；QQ 表情、商城表情和普通图片分开标记，单独媒体默认不抢话，也不会说“我看不到图”来暴露能力限制。
- **多模型档案**：支持 DeepSeek、MiMo、OpenAI 兼容接口、Qwen、Kimi、智谱、SiliconFlow、OpenRouter 以及自定义服务；每个档案可以配置上下文窗口、输入/输出预算、视觉能力、思考强度、Temperature、Top P 和超时。
- **本地管理台**：模型、会话、人设、Prompt、记忆、调试、回放和 QQ 接入都在 WebUI 管理。
- **可回放可审计**：保存收到的消息、回复对象、加载的记忆、最终请求、模型原始输出、决策原因、耗时和气泡拆分结果；历史消息可以隔离回放，不发送 QQ，也不写入生产记忆。
- **隐私默认安全**：数据库、日志、QQ 连接令牌和 API Key 默认全部留在本机并被 Git 忽略，公开仓库只包含占位配置。

## 快速开始

### 环境要求

- Windows、macOS 或 Linux
- Node.js 24 或更高版本
- 一个兼容 Chat Completions 的模型 API（真实回复时需要）
- 真实 QQ 接入需要安装并登录 [NapCatQQ](https://napneko.github.io/)，建议使用专用 QQ 小号

### 安装和启动

```bash
git clone https://github.com/TodayYueC/lucky-qq-ai-friend.git
cd lucky-qq-ai-friend
npm install
npm start
```

打开 <http://127.0.0.1:3210>。

Windows 也可以双击：

- `启动Lucky.cmd`：后台启动并打开管理台；已经运行时只打开管理台。
- `停止Lucky.cmd`：停止当前项目启动的服务。

第一次使用建议先打开“上手指南”，在“会话空间”添加一个群号或 QQ 号，用模拟模式验证上下文、记忆和发言决策。模拟模式不会调用模型，也不会向 QQ 发送消息。

### 配置 API

可以复制 `.env.example` 为 `.env`，填写管理令牌和 OneBot 令牌；模型 API 也可以只在 WebUI 中保存。

```dotenv
HOST=127.0.0.1
PORT=3210
ADMIN_TOKEN=请替换为随机长令牌
ONEBOT_TOKEN=请替换为随机长令牌
LLM_API_KEY=可选，留空时使用 WebUI 中保存的密钥
```

不要把真实密钥写进源码、Issue、截图、测试夹具或 README。`.env`、`data/` 和 SQLite 文件已经被 `.gitignore` 排除。

模型管理页支持多个档案。每个档案可设置：

- Provider、API 地址和模型 ID
- Context Window、Max Input Tokens、Max Output Tokens
- Vision、System Prompt、JSON、Tools 能力标记
- Reasoning effort、Temperature、Top P 和请求超时

MiMo 使用 `max_completion_tokens` 和显式 `thinking` 参数；短聊天建议先用 `none`。供应商的前缀缓存可能让切换到新模型后的第一条完整请求较慢，后续命中缓存后会恢复。具体排查记录见 [MiMo 性能排查](docs/MiMo性能排查.md)。

## 接入真实 QQ

1. 安装并登录 [NapCatQQ](https://napneko.github.io/)，使用你自己的 QQ 小号。QQ 密码、二维码和登录状态由 NapCat/QQ 管理，本项目不保存 QQ 密码。
2. 在 WebUI 的“QQ 接入助手”生成 OneBot 令牌和反向 WebSocket 配置，或手动把以下地址配置到 NapCat：

   ```text
   ws://127.0.0.1:3210/onebot/v11/ws
   ```

3. 在 WebUI 的“连接与设置”填写模型 API 地址、模型 ID 和 API Key，执行模型连接测试。
4. 关闭模拟模式并保存，然后到“会话空间”开启需要参与的群聊或私聊。
5. 发送 `Lucky` 或 @小号进行联调。明确叫到时优先回应，普通旁听消息仍可能保持安静。

项目包含经过 SHA-256 校验的 NapCat Windows 发布包，来源和校验值记录在 `vendor/napcat/manifest.json` 与 `vendor/napcat/shell-manifest.json`。NapCatQQ 是独立的第三方组件，使用时请遵守其许可证、QQ 平台规则和当地法律。

## 系统如何工作

```text
OneBot 消息
  ↓
标准化、去重、附件识别、回复链恢复
  ↓
短时聚合与会话缓存
  ↓
当前说话人 / 被提及对象 / 话题 / 情绪分析
  ↓
短期上下文 + 阶段摘要 + 相关长期记忆 + 当前人设
  ↓
独立发言决策：SILENT / REPLY / REACT / MULTI_MESSAGE
  ↓
回复生成 → 人设与语境检查 → 必要时最多一次重写
  ↓
发送延迟、气泡调度、冷却、QQ 确认
  ↓
写入事件、记忆候选、决策日志和调试轨迹
```

核心模块位于 `server/core/`：

| 模块 | 作用 |
| --- | --- |
| `message-manager` | 标准化 QQ 消息、去重、附件和引用关系 |
| `conversation-manager` | 会话短期上下文、聚合窗口和水位线 |
| `context-builder` | 组织完整语境、相关记忆和人设 |
| `topic-tracker` | 当前话题、证据和阶段摘要 |
| `reply-target-resolver` | 判断消息是在对谁说、是否接 Lucky |
| `speech-decision` | 独立决定是否发言和回复类型 |
| `persona-manager` | 人设、强度和 Prompt 管理 |
| `memory-manager` | 候选、确认、合并、版本、范围和过期 |
| `vision-manager` | 图片与所属消息一起送入视觉模型 |
| `response-generator` | 生成一个或多个自然气泡 |
| `response-validator` | 检查对象误认、复读、说教、刻薄和 AI 固定句式 |
| `message-scheduler` | 发送节奏、冷却、全局限速和失败确认 |
| `model-manager` | 多 Provider 参数映射、预算和真实 usage |

旧版兼容入口仍在 `server/engine.js` 和 `public/`，便于迁移和模拟测试。

## WebUI 功能

- **概览**：连接状态、启用会话、模型档案和工作方式。
- **会话空间**：添加/归档群聊或私聊、开启/暂停、单会话概率、冷却、聚合时间、上下文长度和群人格覆盖。
- **模型管理**：多模型档案、视觉能力、思考强度、预算、连接测试、删除和 MiMo 快速配置。
- **人格与节奏**：基础人格、兴趣、禁用表达、温柔/幽默/活泼/主动/毒舌程度和隔离试聊。
- **记忆花园**：查看、搜索、编辑、锁定、删除、审核候选、调整范围和置信度。
- **Prompt 管理**：System、Decision、Generation、Memory、Vision、Validation 分开编辑。
- **调试**：最近消息、完整模型上下文、加载的记忆、决策理由、token 用量、原始输出、耗时和气泡结果。
- **回放**：选择历史消息区间，在隔离环境使用当前模型和 Prompt 重放；不会发送 QQ，不会写生产记忆。

## 安全与隐私

本项目只提供本地工具，不托管你的 QQ 账号或 API。请特别注意：

- `data/friend.db` 可能包含聊天原文、长期记忆、模型配置和 API Key；不要上传或发给他人。
- 管理台默认只监听 `127.0.0.1`。跨机器访问前必须设置强随机 `ADMIN_TOKEN`，并使用受信任的 HTTPS/WSS 反向代理。
- OneBot 令牌和管理令牌不能相同，也不能使用示例值。
- QQ 群成员应知情并接受 AI 参与；不要把私人聊天、敏感资料或第三方个人信息交给不必要的模型服务商。
- 模型服务商可能保存请求内容和 usage，具体以服务商隐私政策为准。

完整说明见 [SECURITY.md](SECURITY.md)。如果 API Key 曾经进入 Git 历史，必须先在供应商后台撤销，再清理历史；只删除当前文件是不够的。

## 开发和测试

安装依赖后运行：

```bash
npm test                 # Node 测试和 HTTP/OneBot 集成测试
npm run test:ui          # Playwright 浏览器冒烟测试
npm run format:check     # Prettier 检查
npm run docs:build       # 重新生成网页教程
```

UI 测试需要 Microsoft Edge；没有 Edge 时可以先执行 `npx playwright install chromium`，再按项目脚本要求运行。

测试使用临时数据库和模拟模型，不需要真实 API Key，不会发送 QQ 消息。修改核心链路时，建议同时补充：

- A 与 B 互相聊天时不误认成对 AI 说话
- 连续消息和引用链保持消息归属
- 群与私聊、用户与用户之间的记忆隔离
- 普通消息概率、@、接话、冷却和发送确认
- 图片、表情、非 JSON 模型输出和模型超时

## 项目结构

```text
server/                 服务端、OneBot、SQLite、核心编排器
server/core/            新版消息、语境、记忆、决策、模型模块
public/                 原生 JavaScript/CSS WebUI
scripts/                启动、停止、备份、教程构建和评估脚本
tests/                  单元、集成、OneBot 和 UI 测试
docs/                   使用教程、重构设计、口吻和性能说明
vendor/napcat/          经过校验的 NapCat Windows 发布包
data/                   本地运行数据（不会进入 Git）
```

## 参考项目

- [NapCatQQ](https://napneko.github.io/use/integration)：QQ 与 OneBot 接入。
- [NoneBot2](https://nonebot.dev/docs/advanced/adapter)：Python 生态和适配器参考。
- [AstrBot](https://github.com/AstrBotDevs/AstrBot)：多平台模型接入与插件化参考。

本项目是独立实现，不复制上述项目源码。

## 当前边界和后续方向

当前版本面向单进程、单 QQ 账号；关系推断、自动确认长期事实、主动话题调度、表情包选择和更多视觉工具保留了接口，但不默认自动执行。欢迎围绕上下文归属、记忆质量、自然回复和 QQ 连接稳定性提交 Issue 或 Pull Request。

## 许可证

本项目代码以 [MIT License](LICENSE) 发布。`vendor/napcat/` 中的 NapCatQQ 发布包及其依赖遵循各自的上游许可证，发布和分发时请同时遵守上游条款。
