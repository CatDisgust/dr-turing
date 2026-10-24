// 每次调 Claude 花了多少钱（2026-10-24 试用额度）。单位：百万分之一美元（微美元），
// 价格是每百万 token 多少美元，所以 token 数 × 单价正好就是微美元。
// 价格来自 Anthropic 官方价目；写缓存按 5 分钟缓存（输入价 × 1.25）

type Price = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const price = (input: number, output: number, cacheRead: number): Price => ({
  cacheRead,
  cacheWrite: input * 1.25,
  input,
  output,
});

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": price(0.1, 0.5, 0.01),
  "claude-opus-4-8": price(5, 25, 0.5),
  "claude-opus-5": price(5, 25, 0.5),
  "claude-opus-5-5": price(4, 20, 0.2),
  "claude-sonnet-5-5": price(2, 10, 0.2),
};

// Haiku 5.5 一次输入超过 10 万 token 时整次按高一档的价
const HAIKU_LONG = price(0.5, 2.5, 0.05);
const LONG_PROMPT = 100_000;

// 没见过的模型（比如被拒后服务端自动换的模型）按 Opus 5 的价算，宁可多算一点
const UNKNOWN = PRICES["claude-opus-5"];

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

type Iteration = Usage & { model?: string | null };

export function priceOf(model: string, promptTokens = 0): Price {
  if (model.startsWith("claude-haiku-5-5") && promptTokens > LONG_PROMPT) {
    return HAIKU_LONG;
  }
  // 先比长名字：claude-opus-5-5 不能被当成 claude-opus-5 加日期后缀
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((name) => model === name || model.startsWith(`${name}-`));
  return key ? PRICES[key] : UNKNOWN;
}

function oneCost(model: string, usage: Usage) {
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const p = priceOf(model, usage.input_tokens + write + read);
  return (
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    write * p.cacheWrite +
    read * p.cacheRead
  );
}

// 被拒后服务端换模型重跑时，usage.iterations 里每次尝试分开记，要全加上
export function costMicroUsd(
  model: string,
  usage: Usage & { iterations?: Iteration[] | null }
): number {
  const runs = usage.iterations?.length ? usage.iterations : null;
  const total = runs
    ? runs.reduce((sum, run) => sum + oneCost(run.model ?? model, run), 0)
    : oneCost(model, usage);
  return Math.round(total);
}

export const MICRO_PER_CENT = 10_000;

export function dollars(micro: number) {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}
