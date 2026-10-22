import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// 所有 Claude 调用都从这里取客户端和档位，改模型或 effort 只改这一处。
// 读 ANTHROPIC_API_KEY 环境变量，不要把 key 写进代码。
export const claude = new Anthropic();

export const MODEL = "claude-opus-5-5";

// 规划文档的三档：快路径归类和规划用 low，讲解用 medium，会话后复核用 high；
// 建图是离线一次性的，先用 medium，D3 计时后再定
export const TIERS = {
  build: { effort: "medium" },
  fast: { effort: "low" },
  review: { effort: "high" },
  tutor: { effort: "medium" },
} as const;

export type Tier = keyof typeof TIERS;

// 快路径（归类、批改、填规划）用哪个模型。规划文档 D12：划词到讲解首字超过 3 秒时换 Haiku 5.5。
// 先在 /eval/classify 对比两种的准确率和耗时再定，改这一行即可
export const FAST_MODELS = {
  haiku: "claude-haiku-5-5",
  opus: MODEL,
} as const;
export type FastModel = keyof typeof FAST_MODELS;
export const FAST_MODEL: FastModel = "opus";

export function modelFor(tier: Tier, fast: FastModel = FAST_MODEL): string {
  return tier === "fast" ? FAST_MODELS[fast] : MODEL;
}

// 被安全分类器拒绝时由服务端自动换模型重跑（Opus 5.5 默认开启）
export const FALLBACK: {
  betas: Anthropic.Beta.AnthropicBeta[];
  fallbacks: Anthropic.Beta.Messages.BetaFallbacksParam;
} = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};
