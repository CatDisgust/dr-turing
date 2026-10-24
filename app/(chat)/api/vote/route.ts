import { z } from "zod";
import {
  getChatById,
  getLearnerState,
  getVotesByChatId,
  saveEvents,
  saveLearnerState,
  voteMessage,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import { engagementOf, recordEvent } from "@/lib/learner/events";
import { auth } from "@/lib/session";

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter chatId is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function PATCH(request: Request) {
  let chatId: string;
  let messageId: string;
  let type: "up" | "down";

  try {
    ({ chatId, messageId, type } = voteSchema.parse(await request.json()));
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Parameters chatId, messageId, and type are required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new ChatbotError("not_found:vote").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatbotError("forbidden:vote").toResponse();
  }

  await voteMessage({
    chatId,
    messageId,
    type,
  });

  // 点赞点踩也是学生的反应（学生建模方案 A）：记进 Event 表，点踩计入投入度 W。
  // 记不上不影响投票本身
  // 不选课的对话没有课程状态，只记投票
  try {
    await recordVote({
      chatId,
      courseId: chat.courseId,
      messageId,
      studentId: session.user.id,
      type: type === "up" ? "thumbs_up" : "thumbs_down",
    });
  } catch (error) {
    console.error("record vote event failed:", error);
  }

  return new Response("Message voted", { status: 200 });
}

async function recordVote(input: {
  chatId: string;
  courseId: string | null;
  messageId: string;
  studentId: string;
  type: "thumbs_up" | "thumbs_down";
}) {
  if (!input.courseId) {
    return;
  }
  const key = { courseId: input.courseId, studentId: input.studentId };
  const state = await getLearnerState(key);
  if (!state) {
    return;
  }
  const next = recordEvent(state, input.type);
  await saveLearnerState({ state: next });
  await saveEvents([
    {
      ...key,
      kpId: null,
      messageId: input.messageId,
      payload: { turn: engagementOf(next).turn },
      sessionId: input.chatId,
      type: input.type,
    },
  ]);
}
