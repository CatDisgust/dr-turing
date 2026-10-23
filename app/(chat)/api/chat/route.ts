import Anthropic from "@anthropic-ai/sdk";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import {
  claude,
  FALLBACK,
  FAST_MODEL,
  FAST_MODELS,
  MODEL,
  TIERS,
} from "@/lib/claude";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getCourseById,
  getLearnerState,
  getMessagesByChatId,
  reopenChat,
  saveChat,
  saveLearnerState,
  saveMessages,
  saveTransaction,
  updateChatTitleById,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { computeAbilities, describeAbilities } from "@/lib/learner/abilities";
import { emptyLearnerState } from "@/lib/learner/update";
import { auth } from "@/lib/session";
import {
  diagnosisAnswer,
  diagnosisSkip,
  diagnosisStart,
} from "@/lib/tutor/diagnose-turn";
import { describePlan, tutorPrompts } from "@/lib/tutor/prompts";
import { pipeClaudeToUI, toClaudeMessages } from "@/lib/tutor/to-ui-stream";
import {
  answerTurn,
  planAndAsk,
  questionTurn,
  signalTurn,
  startTurn,
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

// 讲解重试后还失败时给学生看的一句话：不贴原始报错，详情在服务端日志里
function tutorDownText(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY 无效或没配置，";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Claude 那边请求太多，";
  }
  return "Claude 暂时没有响应，";
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
    const {
      courseId,
      id,
      message,
      selectedVisibilityType,
      signal,
      targetKpId,
    } = requestBody;

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
      if (chat.reviewedAt) {
        await reopenChat({ id });
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
          plan: null,
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
        const startedAt = Date.now();

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

        // 引擎这一侧先走完：快捷按钮 / 批改上一轮的题 / 归类新问题，再由规划器定本轮动作。
        // 导师用哪段提示词取决于规划，所以归类不能再和讲解并行
        // 诊断入口（D10）优先：“我要学第 N 课”、诊断题的回答、诊断中点“先不做题”
        const diagnosed =
          turn && !targetKpId
            ? await safely("diagnose", () =>
                signal === "skip"
                  ? diagnosisSkip(turn)
                  : signal
                    ? Promise.resolve(null)
                    : diagnosisAnswer(turn).then(
                        (answered) => answered ?? diagnosisStart(turn)
                      )
              )
            : null;
        let result: TurnResult | null = diagnosed?.result ?? null;
        if (diagnosed) {
          // 诊断这一侧已经定好了规划和题
        } else if (turn && targetKpId) {
          result = startTurn(turn, targetKpId);
        } else if (turn && signal) {
          result = signalTurn(turn, signal);
        } else if (turn) {
          result =
            (await safely("grade", () => answerTurn(turn))) ??
            (await safely("classify", () => questionTurn(turn)));
        }
        const engineAt = Date.now();
        const step =
          diagnosed?.step ??
          (turn && result ? await planAndAsk(turn, result, signal) : null);
        const plan = step?.plan;
        const planAt = Date.now();

        if (turn && result && step) {
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
          const { state } = step;
          await safely("save learner state", () => saveLearnerState({ state }));
          if (graded && courseId) {
            // 只追加的作答记录：每次批改一行
            await safely("save transaction", () =>
              saveTransaction({
                attempt: graded.attempt,
                courseId,
                kpId: graded.point.id,
                messageId: message.id,
                sessionId: id,
                studentId: session.user.id,
              })
            );
          }
        }
        if (plan) {
          writer.write({
            messageMetadata: { createdAt: new Date().toISOString(), plan },
            type: "message-metadata",
          });
        }

        const nameOf = (kpId: string) =>
          turn?.graph.points.find((p) => p.id === kpId)?.name ?? kpId;
        const extra = [
          plan ? describePlan(plan, nameOf, Boolean(step?.question)) : null,
          // 三项底层能力：证据够了才说，只调讲法
          turn ? describeAbilities(computeAbilities([turn.state])) : null,
          step?.note
            ? `本轮情况（系统告诉你的，回复里不要提到它）：${step.note}`
            : null,
        ].filter((line): line is string => line !== null);

        const tutorRequest = {
          ...FALLBACK,
          max_tokens: 64_000,
          messages: toClaudeMessages(uiMessages),
          model: MODEL,
          output_config: { effort: TIERS.tutor.effort },
          system: [
            {
              cache_control: { type: "ephemeral" as const },
              text: tutorPrompts[plan?.prompt ?? "aha"],
              type: "text" as const,
            },
            ...extra.map((line) => ({ text: line, type: "text" as const })),
          ],
        };
        let firstTokenMs: number | null = null;
        const onFirstText = () => {
          firstTokenMs = Date.now() - startedAt;
        };

        // 出错兜底（D12）：讲解一个字还没出来就失败，自动再试一次；
        // 还不行就给一句固定提示。引擎这边的状态已经存好，题照常出，流程不断
        let refused = false;
        for (let attempt = 1; ; attempt += 1) {
          try {
            const claudeStream = claude.beta.messages.stream(tutorRequest);
            // biome-ignore lint/performance/noAwaitInLoops: 失败后才重试，本来就是顺序的
            await pipeClaudeToUI(claudeStream, writer, onFirstText);
            const final = await claudeStream.finalMessage();
            refused = final.stop_reason === "refusal";
            break;
          } catch (error) {
            console.error(`[tutor] 讲解第 ${attempt} 次失败`, error);
            if (firstTokenMs === null && attempt < 2) {
              continue;
            }
            const partId = generateUUID();
            writer.write({ id: partId, type: "text-start" });
            writer.write({
              delta: `${firstTokenMs === null ? "" : "\n\n"}（${tutorDownText(error)}讲解这一步先跳过${step?.question ? "，我们直接看题" : "，可以再问一次"}。）`,
              id: partId,
              type: "text-delta",
            });
            writer.write({ id: partId, type: "text-end" });
            break;
          }
        }

        writer.write({
          messageMetadata: {
            createdAt: new Date().toISOString(),
            ...(plan ? { plan } : {}),
            timing: {
              engineMs: engineAt - startedAt,
              fastModel: FAST_MODELS[FAST_MODEL],
              firstTokenMs: firstTokenMs ?? Date.now() - startedAt,
              planMs: planAt - engineAt,
            },
          },
          type: "message-metadata",
        });

        if (refused) {
          writer.write({
            errorText: "这个问题我没法回答，换个问法试试？",
            type: "error",
          });
        } else if (step?.question) {
          // 题面由代码写，不靠导师记得出题；题已经和状态一起存好了
          const partId = generateUUID();
          writer.write({ id: partId, type: "text-start" });
          writer.write({
            delta: `\n\n**检查一下：**${step.question}`,
            id: partId,
            type: "text-delta",
          });
          writer.write({ id: partId, type: "text-end" });
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
              plan: currentMessage.metadata?.plan ?? null,
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
