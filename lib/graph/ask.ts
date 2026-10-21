import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { claude, MODEL, TIERS } from "@/lib/claude";

// 建图的每一步都是“给材料，要一份 JSON”：流式取完整结果，避免非流式请求超时
export async function askJson<T extends z.ZodType>(
  content: Anthropic.ContentBlockParam[],
  schema: T
): Promise<z.infer<T>> {
  const stream = claude.messages.stream({
    max_tokens: 32_000,
    messages: [{ content, role: "user" }],
    model: MODEL,
    output_config: {
      effort: TIERS.build.effort,
      format: zodOutputFormat(schema),
    },
  });

  const message = await stream.finalMessage();
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
