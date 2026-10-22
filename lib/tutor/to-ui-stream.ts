import type Anthropic from "@anthropic-ai/sdk";
import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type Events = AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent>;

// Anthropic 流 → 模板 useChat 能吃的 UI 消息流。只转文字块，思考块不显示。
export async function pipeClaudeToUI(
  events: Events,
  writer: UIMessageStreamWriter<ChatMessage>
) {
  const textIds = new Map<number, string>();

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

// SDK 的流只把开始迭代之后的事件交出来。讲解和归类同时发出、先等归类，
// 所以这里立刻开始读，把事件先存着，等写 UI 的时候再一个个交出去，一个都不丢
export function buffered<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const queue: T[] = [];
  let done = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  (async () => {
    try {
      for await (const item of source) {
        queue.push(item);
        notify();
      }
    } catch (error) {
      failure = error ?? new Error("stream failed");
    } finally {
      done = true;
      notify();
    }
  })();

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
        } else if (failure) {
          throw failure;
        } else if (done) {
          return;
        } else {
          // biome-ignore lint/performance/noAwaitInLoops: 等下一个事件到达
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    },
  };
}
