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
  [`旗舰。思考默认开启，可关闭；支持图片、视频、音频输入。${FLAT_TAIL}`]: `Flagship. Thinking is on by default and can be turned off; accepts image, video and audio input. ${FLAT_TAIL_EN}`,
  [`高频调用。思考默认开启，可关闭；支持图片、视频、音频输入。${FLAT_TAIL}`]: `For frequent calls. Thinking is on by default and can be turned off; accepts image, video and audio input. ${FLAT_TAIL_EN}`,
  [`旗舰。思考不能关闭，默认 max；仅文本。${FLAT_TAIL}`]: `Flagship. Thinking cannot be turned off and defaults to max; text only. ${FLAT_TAIL_EN}`,
  [`原生多模态。思考不能关闭，默认 max；支持图片、视频。${FLAT_TAIL}`]: `Natively multimodal. Thinking cannot be turned off and defaults to max; supports images and video. ${FLAT_TAIL_EN}`,
  "旗舰。思考不能关闭，默认 max；支持看图。1M 内同一价格；输出和输入共用窗口，官方默认输出 128K。":
    "Flagship. Thinking cannot be turned off and defaults to max; supports images. One price within 1M; output and input share the window, with a vendor default output of 128K.",
  "通用模型。思考默认开启，可关闭；支持看图。输出和输入共用 256K 窗口，官方默认输出 32K。":
    "General-purpose. Thinking is on by default and can be turned off; supports images. Output and input share a 256K window, with a vendor default output of 32K.",
  [`最强旗舰。思考不能关闭，官方未写默认档，预填 medium；支持看图。${STANDARD_TAIL}`]: `The strongest flagship. Thinking cannot be turned off; the vendor states no default level, so medium is prefilled; supports images. ${STANDARD_TAIL_EN}`,
  [`复杂编码与智能体。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Complex coding and agents. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`高频轻量。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Lightweight for frequent calls. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  "OpenRouter 路由 · openai/gpt-6-astra。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-astra. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6-sol。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-sol. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · openai/gpt-6-luna。1.05M 上下文、128K 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · openai/gpt-6-luna. 1.05M context, 128K max output; supports images, structured output and tool calls.",
  "OpenRouter 路由 · z-ai/glm-5.3-flash。1,310,720 上下文、131,072 最大输出；支持图片、结构化输出和工具调用。":
    "OpenRouter route · z-ai/glm-5.3-flash. 1,310,720 context, 131,072 max output; supports images, structured output and tool calls.",
  [`上一代旗舰，别名 gpt-5.6。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation flagship, alias gpt-5.6. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`上一代均衡款。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation balanced model. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`上一代高性价比。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `Previous-generation value model. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  [`旗舰，快照 qwen3.8-max-0902。思考默认开启（xhigh），可关闭；支持图片、视频。${FLAT_TAIL}`]: `Flagship, snapshot qwen3.8-max-0902. Thinking is on by default (xhigh) and can be turned off; supports images and video. ${FLAT_TAIL_EN}`,
  [`轻量。思考默认开启（xhigh），可关闭；支持图片、视频。${FLAT_TAIL}`]: `Lightweight. Thinking is on by default (xhigh) and can be turned off; supports images and video. ${FLAT_TAIL_EN}`,
  [`美国跨区推理。思考不能关闭，预填 medium；支持看图。runtime 不支持结构化输出，已关闭 JSON 输出。${STANDARD_TAIL}`]: `US cross-region inference. Thinking cannot be turned off and medium is prefilled; supports images. The runtime has no structured output, so JSON output is turned off. ${STANDARD_TAIL_EN}`,
  [`AWS 模型卡尚未发布，模型 ID 取自 OpenAI 的 Bedrock 指南，JSON 输出先关闭。思考默认 medium，可关闭；支持看图。${STANDARD_TAIL}`]: `The AWS model card is not published yet; the model ID comes from OpenAI's Bedrock guide, and JSON output is off for now. Thinking defaults to medium and can be turned off; supports images. ${STANDARD_TAIL_EN}`,
  "OpenCode Zen · GPT-6 系列旗舰 · Responses 接口。":
    "OpenCode Zen · GPT-6 series flagship · Responses API.",
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
    "Agent Plan 专属 Responses 接口 · 上下文 {0} · LuckyTri 输出预算 {1} · 支持图片理解。默认高强度推理；采样参数由模型服务端处理。",
    "Agent Plan Responses API · context {0} · LuckyTri output budget {1} · supports image understanding. High reasoning by default; sampling parameters are handled by the model service.",
  ],
  [
    "Agent Plan 专属 Responses 接口 · 上下文 {0} · LuckyTri 输出预算 {1} · 文本模型。默认高强度推理；采样参数由模型服务端处理。",
    "Agent Plan Responses API · context {0} · LuckyTri output budget {1} · text model. High reasoning by default; sampling parameters are handled by the model service.",
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
