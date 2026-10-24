import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  claude,
  type FastModel,
  modelFor,
  TIERS,
  type Tier,
} from "@/lib/claude";
import { recordUsage } from "@/lib/spend";

type AskOptions = {
  tier?: Tier;
  maxTokens?: number;
  // 每次都一样的长前缀（比如整门课的知识点列表）放这里，带缓存
  system?: string;
  // 只有评测页会指定：对比快路径用哪个模型
  fastModel?: FastModel;
};

// 建图和归类都是“给材料，要一份 JSON”：流式取完整结果，避免非流式请求超时
export async function askJson<T extends z.ZodType>(
  content: Anthropic.ContentBlockParam[],
  schema: T,
  { tier = "build", maxTokens = 32_000, system, fastModel }: AskOptions = {}
): Promise<z.infer<T>> {
  const stream = claude.messages.stream({
    max_tokens: maxTokens,
    messages: [{ content, role: "user" }],
    model: modelFor(tier, fastModel),
    output_config: {
      effort: TIERS[tier].effort,
      format: zodOutputFormat(schema),
    },
    ...(system
      ? {
          system: [
            {
              cache_control: { type: "ephemeral" as const },
              text: system,
              type: "text" as const,
            },
          ],
        }
      : {}),
  });

  const message = await stream.finalMessage();
  recordUsage(message.model, message.usage);
  if (message.stop_reason === "refusal") {
    throw new Error("Claude 拒绝处理这份材料");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("输出太长，被截断了");
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return schema.parse(JSON.parse(text));
}
