import type Anthropic from "@anthropic-ai/sdk";
import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type Events = AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent>;

// Anthropic 流 → 模板 useChat 能吃的 UI 消息流。只转文字块，思考块不显示。
// 返回写出的字数，调用方据此判断出错时学生是否已经看到了内容
export async function pipeClaudeToUI(
  events: Events,
  writer: UIMessageStreamWriter<ChatMessage>,
  onFirstText?: () => void
): Promise<number> {
  const textIds = new Map<number, string>();
  let written = 0;

  writer.write({ type: "start-step" });
  for await (const event of events) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "text") {
        const id = generateUUID();
        textIds.set(event.index, id);
        writer.write({ id, type: "text-start" });
      }
    } else if (event.type === "content_block_delta") {
      const id = textIds.get(event.index);
      if (id && event.delta.type === "text_delta") {
        if (written === 0) {
          onFirstText?.();
        }
        written += event.delta.text.length;
        writer.write({ delta: event.delta.text, id, type: "text-delta" });
      }
    } else if (event.type === "content_block_stop") {
      const id = textIds.get(event.index);
      if (id) {
        writer.write({ id, type: "text-end" });
        textIds.delete(event.index);
      }
    }
  }
  writer.write({ type: "finish-step" });
  return written;
}

// UI 消息 → Anthropic messages。只带文字；空消息丢掉，连续同角色合并由 API 处理。
export function toClaudeMessages(
  messages: ChatMessage[]
): Anthropic.Beta.BetaMessageParam[] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    return text ? [{ content: text, role: message.role }] : [];
  });
}
