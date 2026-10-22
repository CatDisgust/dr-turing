import "server-only";
import {
  getChatById,
  getCourseById,
  getLearnerState,
  getMessagesByChatId,
  getUnreviewedChats,
  saveChatReport,
  saveLearnerState,
} from "@/lib/db/queries";
import { applyReview, sessionReport } from "@/lib/learner/review";
import type { SessionReport } from "@/lib/types";
import { reviewSession, type TranscriptLine } from "./review";

// 结束一次会话：复核 → 证据转正或撤销 → 算会话报告 → 记在 Chat 上。
// 已经复核过的会话直接返回旧报告，按钮点两次、补跑撞上按钮都不会重复复核

// 开新对话时最多补跑几个没结束的旧会话（假设）
const CATCH_UP_LIMIT = 3;

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : ""
    )
    .join("")
    .trim();
}

export async function endSession(input: {
  chatId: string;
  studentId: string;
  courseId: string;
}): Promise<SessionReport | null> {
  const chat = await getChatById({ id: input.chatId });
  if (!chat || chat.userId !== input.studentId) {
    return null;
  }
  if (chat.report) {
    return chat.report;
  }
  const course = await getCourseById({ id: input.courseId });
  const before = await getLearnerState(input);
  const now = new Date().toISOString();
  if (!(course && before)) {
    // 这门课还没有图谱或学生还没有状态：没有证据可复核，只记下这次会话结束了
    const report: SessionReport = {
      confirmed: 0,
      leaks: 0,
      oGain: [],
      ownSteps: 0,
      retracted: [],
      revealRate: null,
      reviewedAt: now,
      selfProducedRate: null,
      sessionId: input.chatId,
      steps: 0,
    };
    await saveChatReport({ id: input.chatId, report });
    return report;
  }

  const transcript: TranscriptLine[] = (
    await getMessagesByChatId({ id: input.chatId })
  )
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as TranscriptLine["role"],
      text: textOf(m.parts),
    }))
    .filter((line) => line.text !== "");

  const { leaks, verdicts } = await reviewSession({
    graph: course.graph,
    sessionId: input.chatId,
    state: before,
    transcript,
  });

  // 复核要跑一阵子，这期间学生可能在别的对话里又答了题：落状态前重新读一次
  const fresh = (await getLearnerState(input)) ?? before;
  const applied = applyReview(fresh, course.graph, input.chatId, verdicts, now);
  await saveLearnerState({ state: applied.state });
  const report = sessionReport({
    confirmed: applied.confirmed,
    graph: course.graph,
    leaks,
    now,
    retracted: applied.retracted,
    sessionId: input.chatId,
    state: applied.state,
  });
  await saveChatReport({ id: input.chatId, report });
  return report;
}

// 开新对话时补跑：之前没点“结束本次学习”的会话，挨个复核。失败的下次再补
export async function catchUpSessions(input: {
  studentId: string;
  courseId: string;
  exceptChatId: string;
}) {
  const stale = await getUnreviewedChats({
    exceptId: input.exceptChatId,
    limit: CATCH_UP_LIMIT,
    userId: input.studentId,
  });
  for (const chat of stale) {
    try {
      // 一个一个来：每次复核都要读写同一份学生状态
      // biome-ignore lint/performance/noAwaitInLoops: 顺序执行是故意的
      await endSession({ ...input, chatId: chat.id });
    } catch (error) {
      console.error(`catch-up review of ${chat.id} failed:`, error);
    }
  }
}
