import Anthropic from "@anthropic-ai/sdk";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { claude, FALLBACK, MODEL, TIERS } from "@/lib/claude";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { auth } from "@/lib/session";
import { ahaPrompt } from "@/lib/tutor/prompts";
import { pipeClaudeToUI, toClaudeMessages } from "@/lib/tutor/to-ui-stream";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

// demo 阶段把出错原因直接显示出来，省得翻日志；错误信息里不含 key
function describeClaudeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "出错了：ANTHROPIC_API_KEY 无效或没配置。";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "出错了：请求太频繁或额度不足，稍后再试。";
  }
  if (error instanceof Anthropic.APIError) {
    return `出错了（Anthropic ${error.status ?? "网络"}）：${error.message}`;
  }
  return `出错了：${error instanceof Error ? error.message : String(error)}`;
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, selectedVisibilityType } = requestBody;

    const session = await auth();

    if (message?.role !== "user") {
      return new ChatbotError("bad_request:api").toResponse();
    }

    const chat = await getChatById({ id });
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
    } else {
      await saveChat({
        id,
        title: "新对话",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      // 起标题失败不影响讲解，也不能留下未处理的 rejection
      titlePromise = generateTitleFromUserMessage({ message }).catch(
        () => "新对话"
      );
    }

    const messagesFromDb = chat ? await getMessagesByChatId({ id }) : [];
    const uiMessages: ChatMessage[] = [
      ...convertToUIMessages(messagesFromDb),
      message as ChatMessage,
    ];

    await saveMessages({
      messages: [
        {
          attachments: [],
          chatId: id,
          createdAt: new Date(),
          id: message.id,
          parts: message.parts,
          role: "user",
        },
      ],
    });

    const stream = createUIMessageStream<ChatMessage>({
      execute: async ({ writer }) => {
        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          text: string
        ) => {
          writer.write({
            data: {
              message: text,
              modelId: MODEL,
              modelName: "Dr.Turing",
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "思考中…");

        const claudeStream = claude.beta.messages.stream({
          ...FALLBACK,
          max_tokens: 64_000,
          messages: toClaudeMessages(uiMessages),
          model: MODEL,
          output_config: { effort: TIERS.tutor.effort },
          system: [
            {
              cache_control: { type: "ephemeral" },
              text: ahaPrompt,
              type: "text",
            },
          ],
        });

        await pipeClaudeToUI(claudeStream, writer);

        const final = await claudeStream.finalMessage();
        if (final.stop_reason === "refusal") {
          writer.write({
            errorText: "这个问题我没法回答，换个问法试试？",
            type: "error",
          });
        }

        if (titlePromise) {
          try {
            const title = await titlePromise;
            writer.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }
      },
      onError: (error) => {
        console.error("Claude stream error:", error);
        return describeClaudeError(error);
      },
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, {
      vercelId: request.headers.get("x-vercel-id"),
    });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();
  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
