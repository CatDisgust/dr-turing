import "server-only";
import {
  getChatById,
  getCourseById,
  getEventsByStudent,
  getLearnerState,
  getMessagesByChatId,
  getOtherStudentModels,
  getPlanMessagesByStudent,
  getStudentModel,
  getTransactionsByStudent,
  getUnreviewedChats,
  saveChatReport,
  saveEvents,
  saveLearnerState,
  saveStudentModel,
} from "@/lib/db/queries";
import { engagementOf } from "@/lib/learner/events";
import {
  applyNoteOps,
  MIN_MISSES,
  mispredictions,
  readyMisses,
  trustedNotes,
} from "@/lib/learner/notes";
import {
  identityEvents,
  identityPool,
  identityQuestions,
  nextConceptSeq,
} from "@/lib/learner/personal";
import { reviewedAttempts } from "@/lib/learner/predict";
import { armOutcomes, populationPrior } from "@/lib/learner/preference";
import { applyReview, sessionReport } from "@/lib/learner/review";
import { rebuildStudentModel } from "@/lib/learner/student-model";
import { learnRateOf, relearn } from "@/lib/learner/update";
import type { CourseGraph, SessionReport } from "@/lib/types";
import { identify } from "./identify";
import { writeNotes } from "./notes";
import { partText } from "./parts";
import { appendPersonal, loadPersonal } from "./personal-store";
import { reviewSession, type TranscriptLine } from "./review";

// 结束一次会话：复核 → 证据转正或撤销 → 算会话报告 → 记在 Chat 上。
// 已经复核过的会话直接返回旧报告，按钮点两次、补跑撞上按钮都不会重复复核

// 开新对话时最多补跑几个没结束的旧会话（假设）
const CATCH_UP_LIMIT = 3;

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts.map(partText).join("").trim();
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

  const { graph: personal } = await loadPersonal(input.studentId);
  const { concepts, leaks, verdicts } = await reviewSession({
    graph: course.graph,
    personal,
    sessionId: input.chatId,
    state: before,
    transcript,
  });

  // 复核要跑一阵子，这期间学生可能在别的对话里又答了题：落状态前重新读一次
  const fresh = (await getLearnerState(input)) ?? before;
  const applied = applyReview(fresh, course.graph, input.chatId, verdicts, now);
  let { state } = applied;
  await saveLearnerState({ state });
  // 撤销、改判也是原始记录：Transaction 只追加不改，复核结论记成事件
  await saveEvents(
    applied.changes.map((c) => ({
      courseId: input.courseId,
      kpId: c.kpId,
      messageId: c.turnId,
      payload: {
        attemptId: c.attemptId,
        turn: engagementOf(applied.state).turn,
      },
      sessionId: input.chatId,
      studentId: input.studentId,
      type: c.type,
    }))
  );
  // 学生模型从原始记录整份重算（方案 F），学习率 ℓ 变了就按新 ℓ 重算各点的 M、O（方案 B）；
  // 讲法得分、检验过的教学笔记带进学生状态，下一轮规划直接读（方案 C、E）
  try {
    const { model, prior } = await refreshStudentModel({
      chatId: input.chatId,
      graph: course.graph,
      now,
      studentId: input.studentId,
      transcript,
    });
    if (model.learnRate !== learnRateOf(state)) {
      state = relearn(state, course.graph, model.learnRate);
    }
    state = {
      ...state,
      arms: { own: model.arms, prior },
      teachingNotes: trustedNotes(model.notes),
    };
    await saveLearnerState({ state });
  } catch (error) {
    console.error("rebuild student model failed:", error);
  }
  // 个人图谱：先认人再记账。落库前重新读一次日志，认人失败就全部按复核给的编号或新概念记
  const { events: freshEvents, graph: freshPersonal } = await loadPersonal(
    input.studentId
  );
  const pool = identityPool(freshPersonal, [course.graph]);
  const questions = identityQuestions(concepts, pool);
  let answers = new Map<number, string>();
  try {
    answers = await identify(questions);
  } catch (error) {
    console.error("identify concepts failed:", error);
  }
  const nextPersonal = await appendPersonal(
    input.studentId,
    input.chatId,
    identityEvents(
      concepts,
      pool,
      questions,
      answers,
      nextConceptSeq(freshEvents)
    )
  );
  const changed = nextPersonal.log
    .slice(freshPersonal.log.length)
    .map((entry) => ({
      name:
        nextPersonal.concepts.find((c) => c.id === entry.conceptId)?.name ??
        entry.conceptId,
      op: entry.op,
    }));
  const report = sessionReport({
    confirmed: applied.confirmed,
    graph: course.graph,
    leaks,
    now,
    retracted: applied.retracted,
    sessionId: input.chatId,
    state,
  });
  report.concepts = changed;
  report.revised = applied.revised;
  await saveChatReport({ id: input.chatId, report });
  return report;
}

// 写笔记的门槛：demo 在 Vercel 上设 NOTES_MIN_MISSES=1，一轮就能演出来；没设就是正式版的 2
function notesMinMisses(): number {
  const n = Number(process.env.NOTES_MIN_MISSES);
  return Number.isInteger(n) && n >= 1 ? n : MIN_MISSES;
}

// 学生模型每次结束学习都从原始记录整份重算（学生建模方案 F）；文字笔记原样保留、重新检验。
// 这次会话里猜错过，就让 Claude 改一次笔记（方案 E）
async function refreshStudentModel(input: {
  studentId: string;
  chatId: string;
  graph: CourseGraph;
  transcript: TranscriptLine[];
  now: string;
}) {
  const { studentId, graph } = input;
  const [transactions, events, old, messages, others] = await Promise.all([
    getTransactionsByStudent({ studentId }),
    getEventsByStudent({ studentId }),
    getStudentModel({ studentId }),
    getPlanMessagesByStudent({ studentId }),
    getOtherStudentModels({ studentId }),
  ]);
  const kinds = Object.fromEntries(graph.points.map((p) => [p.id, p.kind]));
  const data = rebuildStudentModel(
    transactions,
    events,
    old?.notes,
    messages,
    kinds
  );
  try {
    const rows = reviewedAttempts(transactions, events);
    const outcomes = armOutcomes(
      messages,
      rows,
      events.map((e) => ({ messageId: e.messageId ?? "", type: e.type }))
    );
    // 同一种讲法下攒够几次猜错才写，一次可能只是偶然
    const misses = readyMisses(
      mispredictions(rows, outcomes),
      data.notes,
      input.chatId,
      notesMinMisses()
    );
    if (misses.length > 0) {
      const { ops, evidenceIds } = await writeNotes({
        graph,
        misses,
        notes: data.notes,
        transcript: input.transcript,
      });
      data.notes = applyNoteOps(data.notes, ops, evidenceIds, input.now, () =>
        crypto.randomUUID()
      );
    }
  } catch (error) {
    console.error("write teaching notes failed:", error);
  }
  await saveStudentModel({ data, studentId });
  // 冷启动先验：其他学生每种讲法的平均效果（经验贝叶斯，方案 C）
  return {
    model: data,
    prior: populationPrior(others.map((o) => o.arms ?? {})),
  };
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
