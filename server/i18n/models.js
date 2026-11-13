// English for the model library: provider names, tiers, thinking levels and the
// notes beside each preset. Product and model names stay as the vendors write
// them; only the Chinese around them is translated.
const STANDARD_TAIL = "输入超过 272K 整单按长上下文计价。";
const STANDARD_TAIL_EN =
  "Input over 272K is billed entirely at the long-context rate.";
const FLAT_TAIL = "1M 内同一价格，没有分档。";
const FLAT_TAIL_EN = "One price within 1M, no tiers.";

export const MODEL_LABELS = {
  // tiers
  "标准（输入 ≤272K）": "Standard (input ≤272K)",
  "百万（1.05M）": "Million (1.05M)",

  // thinking levels
  关闭: "Off",
  极低: "Minimal",
  低: "Low",
  中: "Medium",
  高: "High",
  极高: "Extra high",
  最深: "Deepest",

  // providers and labels
  火山方舟: "Volcengine Ark",
  "火山方舟 Agent Plan": "Volcengine Ark Agent Plan",
  "火山方舟 Coding Plan": "Volcengine Ark Coding Plan",
  "方舟自动路由（ark-code-latest）": "Ark auto-routing (ark-code-latest)",
  "GLM 最新别名（glm-latest）": "GLM latest alias (glm-latest)",
  "Gemini 3.1 Pro Preview（预览版）": "Gemini 3.1 Pro Preview (Preview)",
  "Gemini 3 Flash Preview（预览版）": "Gemini 3 Flash Preview (Preview)",
  "小米 MiMo": "Xiaomi MiMo",
  "智谱 GLM": "Zhipu GLM",
  通义千问: "Qwen",
  "亚马逊 Bedrock": "Amazon Bedrock",
  自定义: "Custom",
  自定义兼容接口: "Custom compatible API",
  "OpenRouter · 自选模型": "OpenRouter · your own model",

  // notes
  "控制台管理的动态模型入口；实际使用哪一个模型由 Coding Plan 控制台选择，切换通常数分钟后生效。支持图片理解。":
    "A dynamic model entry managed in the console; which model is actually used is chosen in the Coding Plan console, and a switch usually takes a few minutes. Supports image understanding.",
  "Agent Plan 自动路由入口；由套餐配置动态选择可用语言模型，支持图片理解。":
    "Agent Plan auto-routing entry; the plan dynamically selects an available language model. Supports image understanding.",
  [`当前主力。思考默认开启（high），可关闭；支持看图。${FLAT_TAIL}`]: `The current mainstay. Thinking is on by default (high) and can be turned off; supports images. ${FLAT_TAIL_EN}`,
  [`V4-Pro-0813。思考默认开启（high），可关闭；仅文本。${FLAT_TAIL}`]: `V4-Pro-0813. Thinking is on by default (high) and can be turned off; text only. ${FLAT_TAIL_EN}`,
  "可选：走官方 Responses 接口（/responses）。思考默认开启（high），可关闭；仅文本。默认对话仍用 Chat Completions 的 DeepSeek V4 Pro。":
    "Optional: uses the vendor Responses API (/responses). Thinking is on by default (high) and can be turned off; text only. Ordinary chat still uses DeepSeek V4 Pro over Chat Completions.",
  [`旗舰。思考默认开启，可关闭；支持图片、视频、音频输入。${FLAT_TAIL}`]: `Flagship. Thinking is on by default and can be turned off; accepts image, video and audio input. ${FLAT_TAIL_EN}`,
  [`高频调用。思考默认开启，可关闭；支持图片、视频、音频输入。${FLAT_TAIL}`]: `For frequent calls. Thinking is on by default and can be turned off; accepts image, video and audio input. ${FLAT_TAIL_EN}`,
  [`旗舰。思考不能关闭，默认 max；仅文本。${FLAT_TAIL}`]: `Flagship. Thinking cannot be turned off and defaults to max; text only. ${FLAT_TAIL_EN}`,
  [`原生多模态。思考不能关闭，默认 max；支持图片、视频。${FLAT_TAIL}`]: `Natively multimodal. Thinking cannot be turned off and defaults to max; supports images and video. ${FLAT_TAIL_EN}`,
  "新一代旗舰（2026-10 发布）。思考不能关闭，默认 max；支持看图。1M 共享窗口，预留 128K 输出预算；国内密钥用 api.moonshot.cn，海外密钥需改为 api.moonshot.ai。":
    "Next-generation flagship (released 2026-10). Thinking cannot be turned off and defaults to max; supports images. 1M shared window with a 128K output budget reserved; mainland keys use api.moonshot.cn, international keys must switch to api.moonshot.ai.",
  "旗舰。思考不能关闭，默认 max；支持看图。1M 内同一价格；输出和输入共用窗口，官方默认输出 128K。":
    "Flagship. Thinking cannot be turned off and defaults to max; supports images. One price within 1M; output and input share the window, with a vendor default output of 128K.",
  "通用模型。思考默认开启，可关闭；支持看图。输出和输入共用 256K 窗口，官方默认输出 32K。":
    "General-purpose. Thinking is on by default and can be turned off; supports images. Output and input share a 256K window, with a vendor default output of 32K.",
  "官方推荐主力。自适应思考，默认 medium；支持看图。上下文 1M，输出上限 128K。":
    "Vendor-recommended mainstay. Adaptive thinking, medium by default; supports images. 1M context, 128K max output.",
  "速度与智力的平衡。自适应思考，默认 high；支持看图。上下文 1M，输出上限 128K。":
    "Balanced speed and intelligence. Adaptive thinking, high by default; supports images. 1M context, 128K max output.",
  "高频低延迟。自适应思考，默认 medium；支持看图。上下文 1M，输出上限 128K。":
    "Low latency for frequent calls. Adaptive thinking, medium by default; supports images. 1M context, 128K max output.",
  "最新重推理与长程代理（2026-11 发布）。自适应思考，默认 high；支持看图。上下文 1M，输出上限 128K；需账号满足 30 天数据留存。":
    "Latest heavy-reasoning and long-horizon agent model (released 2026-11). Adaptive thinking, high by default; supports images. 1M context, 128K max output; requires an account with 30-day data retention.",
  "长程代理与重推理。自适应思考，默认 high；支持看图。上下文 1M，输出上限 128K。":
    "Long-horizon agents and heavy reasoning. Adaptive thinking, high by default; supports images. 1M context, 128K max output.",
  "正式版（2026-11-12 发布）· Gemini 4 高速全能主力，免费与付费层级均可用。思考档 low/medium/high/xhigh（默认 high，不支持关闭或 minimal）；支持看图。统一 1M 窗口，单次同步输出 64K；忽略采样参数。":
    "GA (released 2026-11-12) · Gemini 4 fast all-round mainstay, available on both free and paid tiers. Thinking levels low/medium/high/xhigh (high by default; off and minimal unsupported); supports images. Unified 1M window, 64K synchronous output; sampling parameters are ignored.",
  "正式版（2026-11-10 发布）· 最强深度推理旗舰，仅限 Gemini API 付费层级（无免费额度）。思考档 low/medium/high（默认 medium，不支持关闭或 minimal）；支持看图。统一 1M 窗口，单次同步输出 64K；忽略采样参数。":
    "GA (released 2026-11-10) · Strongest deep-reasoning flagship, paid Gemini API tier only (no free tier). Thinking levels low/medium/high (medium by default; off and minimal unsupported); supports images. Unified 1M window, 64K synchronous output; sampling parameters are ignored.",
  "正式版 · 高效前沿推理，仅限 Gemini API 付费层级。思考档 low/medium/high（默认 medium，不支持关闭或 minimal）；支持看图。统一 1M 窗口，单次同步输出 64K；忽略采样参数。":
    "GA · Efficient frontier reasoning, paid Gemini API tier only. Thinking levels low/medium/high (medium by default; off and minimal unsupported); supports images. Unified 1M window, 64K synchronous output; sampling parameters are ignored.",
  "正式版 · Gemini 3 系主力 Flash，免费与付费层级均可用。思考档 low/medium/high（默认 medium，不支持 minimal）；支持看图。输入 1M，输出 64K；忽略采样参数。":
    "GA · Gemini 3 flagship Flash, available on both free and paid tiers. Thinking levels low/medium/high (medium by default; minimal unsupported); supports images. 1M input, 64K output; sampling parameters are ignored.",
  "正式版 · 均衡速度与多模态推理，免费与付费层级均可用。思考档 minimal/low/medium/high（默认 medium）；支持看图。输入 1M，输出 64K；忽略采样参数。":
    "GA · Balanced speed and multimodal reasoning, available on both free and paid tiers. Thinking levels minimal/low/medium/high (medium by default); supports images. 1M input, 64K output; sampling parameters are ignored.",
  "正式版 · 高吞吐、低成本轻量多模态，免费与付费层级均可用。思考档 minimal/low/medium/high（预填 low）；支持看图。适合高频回合与备用兜底。":
    "GA · High-throughput, low-cost lightweight multimodal model, available on both free and paid tiers. Thinking levels minimal/low/medium/high (low prefilled); supports images. Suited to frequent turns and backup failover.",
  "预览版（Preview）· 仅限 Gemini API 付费层级，限流较严且可能随至少两周通知退场。思考档 low/medium/high（默认 high）；支持看图。输入 1M，输出 64K。":
    "Preview · Paid Gemini API tier only, with stricter rate limits and subject to retirement with at least two weeks notice. Thinking levels low/medium/high (high by default); supports images. 1M input, 64K output.",
  "预览版（Preview）· 早期第三代 Flash 预览端点，新项目建议优先用正式版 Gemini 4 Hydrogen 或 3.8 Flash。思考档 minimal/low/medium/high（默认 high）；支持看图。输入 1M，输出 64K。":
    "Preview · Early 3rd-gen Flash preview endpoint; prefer GA Gemini 4 Hydrogen or 3.8 Flash for new setups. Thinking levels minimal/low/medium/high (high by default); supports images. 1M input, 64K output.",
  [`最强旗舰。思考不能关闭，官方未写默认档，预填 medium；支持看图。${STANDARD_TAIL}`]: `The strongest flagship. Thinking cannot be turned off; the vendor states no default level, so medium is prefilled; supports images. ${STANDARD_TAIL_EN}`,
  [`复杂编码与专业推理主力（替代初版 6-Sol）。思考不能关闭（low 至 max，默认 medium）；支持看图。${STANDARD_TAIL}`]: `Mainstay for complex coding and professional reasoning (supersedes initial 6-Sol). Thinking cannot be turned off (low to max, medium by default); supports images. ${STANDARD_TAIL_EN}`,
  [`最新中档高速多模态与自然写作（2026-10-26 发布）。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Latest mid-tier fast multimodal and natural-writing model (released 2026-10-26). Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`复杂编码与智能体。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Complex coding and agents. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`高频轻量。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Lightweight for frequent calls. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  "OpenRouter 路由 · openai/gpt-6-astra。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-astra. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6.1-sol。1.05M 上下文、128K 最大输出；思考不能关闭；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6.1-sol. 1.05M context, 128K max output; thinking cannot be turned off; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6.1-terra。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6.1-terra. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6-sol。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-sol. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6-luna。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-luna. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · google/gemini-4-hydrogen。1M 统一窗口、单次同步输出 64K；思考档 low/medium/high/xhigh（默认 high）；支持图片、结构化输出和工具调用。":
    "OpenRouter route · google/gemini-4-hydrogen. Unified 1M window, 64K synchronous output; thinking levels low/medium/high/xhigh (high by default); supports images, structured output and tool calls.",
  "OpenRouter 路由 · google/gemini-4-carbon。1M 统一窗口、单次同步输出 64K；思考档 low/medium/high（默认 medium）；支持图片、结构化输出和工具调用。":
    "OpenRouter route · google/gemini-4-carbon. Unified 1M window, 64K synchronous output; thinking levels low/medium/high (medium by default); supports images, structured output and tool calls.",
  "OpenRouter 路由 · google/gemini-4-argon。1M 统一窗口、单次同步输出 64K；思考档 low/medium/high（默认 medium）；支持图片、结构化输出和工具调用。":
    "OpenRouter route · google/gemini-4-argon. Unified 1M window, 64K synchronous output; thinking levels low/medium/high (medium by default); supports images, structured output and tool calls.",
  "OpenRouter 路由 · z-ai/glm-5.3-flash。1,310,720 上下文、131,072 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · z-ai/glm-5.3-flash. 1,310,720 context, 131,072 max output; supports images, structured output and tool calls.",
  [`上一代旗舰，别名 gpt-5.6。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation flagship, alias gpt-5.6. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`上一代均衡款。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation balanced model. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`上一代高性价比。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation value model. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`旗舰，快照 qwen3.8-max-0902。思考默认开启（xhigh），可关闭；支持图片、视频。${FLAT_TAIL}`]: `Flagship, snapshot qwen3.8-max-0902. Thinking is on by default (xhigh) and can be turned off; supports images and video. ${FLAT_TAIL_EN}`,
  [`轻量。思考默认开启（xhigh），可关闭；支持图片、视频。${FLAT_TAIL}`]: `Lightweight. Thinking is on by default (xhigh) and can be turned off; supports images and video. ${FLAT_TAIL_EN}`,
  [`美国跨区推理。思考不能关闭，预填 medium；支持看图。runtime 不支持结构化输出，已关闭 JSON 输出。${STANDARD_TAIL}`]: `US cross-region inference. Thinking cannot be turned off and medium is prefilled; supports images. The runtime has no structured output, so JSON output is turned off. ${STANDARD_TAIL_EN}`,
  [`美国跨区推理（us.openai.gpt-6.1-sol）。思考不能关闭，默认 medium；支持看图，JSON 输出关闭。${STANDARD_TAIL}`]: `US cross-region inference (us.openai.gpt-6.1-sol). Thinking cannot be turned off and defaults to medium; supports images, with JSON output turned off. ${STANDARD_TAIL_EN}`,
  [`美国跨区推理（us.openai.gpt-6.1-terra）。思考默认 medium，可关闭；支持看图，JSON 输出关闭。${STANDARD_TAIL}`]: `US cross-region inference (us.openai.gpt-6.1-terra). Thinking defaults to medium and can be turned off; supports images, with JSON output turned off. ${STANDARD_TAIL_EN}`,
  [`AWS 模型卡尚未发布，模型 ID 取自 OpenAI 的 Bedrock 指南，JSON 输出先关闭。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `The AWS model card is not published yet; the model ID comes from OpenAI's Bedrock guide, and JSON output is off for now. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  "OpenCode Zen · GPT-6 系列旗舰 · Responses 接口。":
    "OpenCode Zen · GPT-6 series flagship · Responses API.",
  "OpenCode Zen · GPT-6.1 编码与专业推理主力 · Responses 接口。":
    "OpenCode Zen · GPT-6.1 coding and professional reasoning mainstay · Responses API.",
  "OpenCode Zen · GPT-6 均衡款 · Responses 接口。":
    "OpenCode Zen · GPT-6 balanced · Responses API.",
  "OpenCode Zen · GPT-6 轻量款 · Responses 接口。":
    "OpenCode Zen · GPT-6 lightweight · Responses API.",
  "OpenCode Zen · 快速推理 · Chat Completions 接口。":
    "OpenCode Zen · fast inference · Chat Completions API.",
  "OpenCode Zen · DeepSeek V4 旗舰 · Chat Completions 接口。":
    "OpenCode Zen · DeepSeek V4 flagship · Chat Completions API.",
  "OpenCode Zen · 轻量高速 · Chat Completions 接口。":
    "OpenCode Zen · lightweight and fast · Chat Completions API.",
  "OpenCode Zen · 智谱轻量多模态 · Chat Completions 接口。":
    "OpenCode Zen · Zhipu lightweight multimodal · Chat Completions API.",
  "OpenCode Zen · 智谱旗舰 · Chat Completions 接口。":
    "OpenCode Zen · Zhipu flagship · Chat Completions API.",
  "OpenCode Zen · Kimi 旗舰 · Chat Completions 接口。":
    "OpenCode Zen · Kimi flagship · Chat Completions API.",
  "OpenCode Zen · 通义千问轻量多模态 · Anthropic Messages 接口。":
    "OpenCode Zen · Qwen lightweight multimodal · Anthropic Messages API.",
  "OpenCode Zen · MiniMax 主力模型 · Chat Completions 接口。":
    "OpenCode Zen · MiniMax main model · Chat Completions API.",
  "OpenAI 兼容接口。上下文先按 128K 填，思考档可按供应商再改。":
    "OpenAI-compatible API. Context is prefilled at 128K; the thinking level can be changed per provider.",
  "已填好 OpenRouter API 地址。请自行填写模型 ID、API Key，并按所选模型设置上下文、输出和能力参数。":
    "The OpenRouter API URL is filled in. Enter the model ID and API key yourself, and set the context, output and ability parameters for the chosen model.",
};

export const MODEL_PATTERNS = [
  [
    "OpenCode Go · {0} · {1} 接口。默认上下文和输出预算为保守起始值，可按账户实际模型上限调整。",
    "OpenCode Go · {0} · {1} API. Default context and output budgets are conservative starting values; adjust them to your account's real model limits.",
  ],
  [
    "Agent Plan 专属 Responses 接口 · 上下文 {0} · LuckyTri 输出预算 {1} · 支持图片理解。采样参数由模型服务端处理。",
    "Agent Plan Responses API · context {0} · LuckyTri output budget {1} · supports image understanding. Sampling parameters are handled by the model service.",
  ],
  [
    "Agent Plan 专属 Responses 接口 · 上下文 {0} · LuckyTri 输出预算 {1} · 文本模型。采样参数由模型服务端处理。",
    "Agent Plan Responses API · context {0} · LuckyTri output budget {1} · text model. Sampling parameters are handled by the model service.",
  ],
  [
    "Coding Plan 专属 Responses 接口 · 上下文 {0} · 官方最大输出 {1} · 支持图片理解。默认中等推理；Kimi K2.8 Preview 在 LuckyTri 中预留 64K 输出预算以保留长上下文。",
    "Coding Plan–only Responses API · context {0} · vendor max output {1} · supports image understanding. Medium reasoning by default; Kimi K2.8 Preview reserves a 64K output budget in LuckyTri to keep the long context.",
  ],
  [
    "Coding Plan 专属 Responses 接口 · 上下文 {0} · 官方最大输出 {1} · 文本模型。默认中等推理；Kimi K2.8 Preview 在 LuckyTri 中预留 64K 输出预算以保留长上下文。",
    "Coding Plan–only Responses API · context {0} · vendor max output {1} · text model. Medium reasoning by default; Kimi K2.8 Preview reserves a 64K output budget in LuckyTri to keep the long context.",
  ],
];
