# MiMo 模型速度排查

当前项目此前的 MiMo 档案是 `mimo-v2.5-pro`、`reasoningEffort=low`、`maxOutputTokens=81920`。最近日志中它的单次生成耗时约 19–50 秒，`reasoning_tokens` 约 487–1100，而可见回复通常只有一两句。这说明等待主要花在隐藏思考，不是 QQ 连接或缓存命中。

MiMo 官方 OpenAI 兼容接口的 thinking 默认是 `enabled`，关闭时需要明确发送 `thinking: { "type": "disabled" }`；它的接口文档同时使用 `max_completion_tokens`，该上限包含可见输出和推理输出。官方还说明 thinking 模式下 `temperature` 和 `top_p` 会被强制为推荐值。[MiMo OpenAI Chat Completions 文档](https://mimo.mi.com/docs/en-US/api/chat/openai-api) [MiMo 参数文档](https://mimo.mi.com/docs/en-US/api/guidance/model-hyperparameters)

项目现在根据 MiMo Provider、域名或模型名识别该模型：

- `none` 发送 `thinking.disabled`，使用 `max_completion_tokens`，适合群聊短回复。
- `low / medium / high` 发送 `thinking.enabled`。MiMo 接口是启用/关闭两档，这些值表示启用思考，不会像 DeepSeek 那样细分预算。
- 核心群聊链路里，MiMo 的发言决策和回复复审属于辅助调用，会自动使用 `thinking.disabled`；真正生成回复和重写仍按 `low / medium / high` 开启思考，避免一条消息连续等待多次深思。
- 普通模型继续使用原来的 `max_tokens` 和 `reasoning_effort` 逻辑。

模型管理页的 MiMo 档案会显示隐藏思考、历史耗时和上限的解释，并提供“一键切换快速聊天配置”。当前 `mimo-v2.5-pro` 档案已保持 `none + 2048`。短请求实测同一线路关闭 thinking 约 3–4 秒；开启 thinking 会升到约 12–22 秒。2048 会限制最坏情况下的隐藏推理长度，但无法把 MiMo 变成 DeepSeek 的低档速度。

这次对 `mimo-v2.5` 做了同口径直连验证：短请求约 1.7 秒，说明 API 地址和请求参数没有把它强制变成思考模式；但切换模型后的第一条完整人设请求没有命中供应商的前缀缓存，日志耗时约 54.8 秒、缓存 token 为 0。相同请求再次发送后缓存约 9.4K token，耗时约 4.8 秒；连续三次带新消息的请求都在约 2.7–4.5 秒。也就是说，慢点来自 `token-plan-cn.xiaomimimo.com` 对 `mimo-v2.5` 的冷前缀缓存建立，客户端无法把这段供应商侧建立时间压掉。为了避免实际聊天遇到这次长等待，使用更稳定的 `mimo-v2.5-pro + none`。

模型删除也已经加入。`default` 不能删除；删除其他档案时，引用它的会话自动切回 `default`，视觉兼容模型引用则恢复为跟随主模型。删除前项目已生成备份。
