import { describe, expect, it } from "vitest";
import { costMicroUsd, dollars, priceOf } from "../pricing";

describe("costMicroUsd", () => {
  it("Opus 5.5：输入 4 美元、输出 20 美元每百万 token", () => {
    expect(
      costMicroUsd("claude-opus-5-5", {
        input_tokens: 1000,
        output_tokens: 500,
      })
    ).toBe(1000 * 4 + 500 * 20);
  });

  it("读缓存 0.2、写缓存 5（输入价 × 1.25）", () => {
    expect(
      costMicroUsd("claude-opus-5-5", {
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 10_000,
        input_tokens: 0,
        output_tokens: 0,
      })
    ).toBe(2000 * 5 + 10_000 * 0.2);
  });

  it("Haiku 5.5 一次输入超过 10 万 token 时整次按高一档", () => {
    const short = { input_tokens: 100_000, output_tokens: 1000 };
    const long = { input_tokens: 100_001, output_tokens: 1000 };
    expect(costMicroUsd("claude-haiku-5-5", short)).toBe(
      Math.round(100_000 * 0.1 + 1000 * 0.5)
    );
    expect(costMicroUsd("claude-haiku-5-5", long)).toBe(
      Math.round(100_001 * 0.5 + 1000 * 2.5)
    );
  });

  it("有 iterations 时每次尝试按各自模型的价加起来", () => {
    expect(
      costMicroUsd("claude-opus-5-5", {
        input_tokens: 100,
        iterations: [
          { input_tokens: 100, model: null, output_tokens: 10 },
          { input_tokens: 100, model: "claude-opus-5", output_tokens: 50 },
        ],
        output_tokens: 50,
      })
    ).toBe(100 * 4 + 10 * 20 + 100 * 5 + 50 * 25);
  });

  it("没见过的模型按 Opus 5 的价，宁可多算", () => {
    expect(priceOf("claude-something-new").input).toBe(5);
    expect(priceOf("claude-opus-5-5-20261001").input).toBe(4);
  });

  it("显示成美元两位小数", () => {
    expect(dollars(5_000_000)).toBe("$5.00");
    expect(dollars(1_234_567)).toBe("$1.23");
  });
});
