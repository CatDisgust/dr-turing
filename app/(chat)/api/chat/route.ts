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
  getCourseById,
  getLearnerState,
  getMessagesByChatId,
  saveChat,
  saveLearnerState,
  saveMessages,
  updateChatTitleById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { emptyLearnerState } from "@/lib/learner/update";
import { auth } from "@/lib/session";
import { ahaPrompt } from "@/lib/tutor/prompts";
import {
  buffered,
  pipeClaudeToUI,
  toClaudeMessages,
} from "@/lib/tutor/to-ui-stream";
import {
  answerTurn,
  askQuestion,
  questionTurn,
  signalTurn,
  type Turn,
  type TurnResult,
} from "@/lib/tutor/turn";
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

// 引擎这一侧要用的课程图谱和学生状态。读不到就当没有课程，照常讲解
async function loadTurn(input: {
  courseId: string;
  studentId: string;
  sessionId: string;
  turnId: string;
  text: string;
}): Promise<Turn | null> {
  try {
    const course = await getCourseById({ id: input.courseId });
    if (!course) {
      return null;
    }
    const state =
      (await getLearnerState(input)) ??
      emptyLearnerState(input.studentId, input.courseId);
    return {
      graph: course.graph,
      now: new Date().toISOString(),
      sessionId: input.sessionId,
      state,
      text: input.text,
      turnId: input.turnId,
    };
  } catch (error) {
    console.error("load learner state failed:", error);
    return null;
  }
}

// 批改、归类、存状态任何一步失败，都只是这一轮不亮、不批改，不影响讲解
async function safely<T>(
  label: string,
  work: () => Promise<T>
): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    console.error(`${label} failed:`, error);
    return null;
  }
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
    const { courseId, id, message, selectedVisibilityType, signal } =
      requestBody;

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
          status: string
        ) => {
          writer.write({
            data: {
              message: status,
              modelId: MODEL,
              modelName: "Dr.Turing",
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "思考中…");

        const text = message.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n");
        const turn = courseId
          ? await loadTurn({
              courseId,
              sessionId: id,
              studentId: session.user.id,
              text,
              turnId: message.id,
            })
          : null;

        // 快捷按钮、批改上一轮的题：要先知道结果，导师才知道怎么接
        let result: TurnResult | null = null;
        if (turn && signal) {
          result = signalTurn(turn, signal);
        } else if (turn) {
          result = await safely("grade", () => answerTurn(turn));
        }

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
            ...(result?.note
              ? [
                  {
                    text: `本轮情况（系统告诉你的，回复里不要提到它）：${result.note}`,
                    type: "text" as const,
                  },
                ]
              : []),
          ],
        });

        const events = buffered(claudeStream);

        // 新问题：归类和讲解同时发出；先等归类，讲解开始时节点已经亮了
        if (turn && !result) {
          result = await safely("classify", () => questionTurn(turn));
        }
        if (turn && result) {
          const { graded, touched } = result;
          if (touched) {
            writer.write({
              data: { kpId: touched.id, name: touched.name },
              transient: true,
              type: "data-node-touched",
            });
          }
          if (graded) {
            writer.write({
              data: {
                correct: graded.correct,
                kpId: graded.point.id,
                misconception: graded.misconception,
                name: graded.point.name,
              },
              transient: true,
              type: "data-graded",
            });
          }
          const { state } = result;
          await safely("save learner state", () => saveLearnerState({ state }));
        }

        await pipeClaudeToUI(events, writer);

        const final = await claudeStream.finalMessage();
        if (final.stop_reason === "refusal") {
          writer.write({
            errorText: "这个问题我没法回答，换个问法试试？",
            type: "error",
          });
        } else if (turn && result?.askAbout) {
          // 讲完出一道题：题面由代码写，不靠导师记得出题
          const asked = askQuestion(turn, result.state, result.askAbout);
          if (asked) {
            const partId = generateUUID();
            writer.write({ id: partId, type: "text-start" });
            writer.write({
              delta: `\n\n**检查一下：**${asked.question}`,
              id: partId,
              type: "text-delta",
            });
            writer.write({ id: partId, type: "text-end" });
            await safely("save question", () =>
              saveLearnerState({ state: asked.state })
            );
          }
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
