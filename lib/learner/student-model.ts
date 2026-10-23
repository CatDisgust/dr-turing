import type {
  Attempt,
  KnowledgePoint,
  StudentEventType,
  StudentModelData,
  TeachingNote,
} from "@/lib/types";
import { fitLearnRate } from "./fit";
import { checkNotes } from "./notes";
import { calibrate, reviewedAttempts } from "./predict";
import { armOutcomes, countArms } from "./preference";

// 学生模型（学生建模方案 F）：从两张只追加的表——作答 Transaction、反应 Event——整份重算，
// 讲法的效果还要对上每条回复用了哪种讲法（Message_v2.plan）。
// notes 的文字是 Claude 写的，没法重算，原样带过来；它们的 hits、misses 照样重算

export function rebuildStudentModel(
  transactions: readonly { attempt: Attempt; kpId: string }[],
  events: readonly {
    type: StudentEventType;
    messageId?: string;
    payload: { attemptId?: string };
  }[],
  notes: readonly TeachingNote[] = [],
  messages: Parameters<typeof armOutcomes>[0] = [],
  // 知识点 id → 类型，检验笔记里的 when.kind 要用
  kinds: Readonly<Record<string, KnowledgePoint["kind"]>> = {}
): StudentModelData {
  const reactions: Partial<Record<StudentEventType, number>> = {};
  for (const e of events) {
    reactions[e.type] = (reactions[e.type] ?? 0) + 1;
  }
  // 复核撤销、改判过的证据按复核后的算
  const rows = reviewedAttempts(transactions, events);
  const graded = rows.filter((t) => t.attempt.correct !== undefined);
  // 每轮讲解的效果（方案 C），讲法得分和笔记检验都从这里来
  const outcomes = armOutcomes(
    messages,
    rows,
    events.map((e) => ({ messageId: e.messageId ?? "", type: e.type }))
  );
  return {
    answers: {
      independentCorrect: graded.filter(
        (t) => t.attempt.correct === true && !t.attempt.hinted
      ).length,
      total: graded.length,
    },
    arms: countArms(outcomes),
    calibration: calibrate(rows),
    learnRate: fitLearnRate(rows),
    notes: checkNotes(notes, outcomes, kinds),
    reactions,
    rebuiltFrom: { events: events.length, transactions: transactions.length },
    style: null,
  };
}
