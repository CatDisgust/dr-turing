import type { Attempt, StudentEventType, StudentModelData } from "@/lib/types";
import { BKT } from "./config";
import { calibrate, reviewedAttempts } from "./predict";

// 学生模型（学生建模方案 F）：从两张只追加的表——作答 Transaction、反应 Event——整份重算。
// notes 是 Claude 写的文字，没法重算，原样带过来

export function rebuildStudentModel(
  transactions: readonly { attempt: Attempt; kpId: string }[],
  events: readonly {
    type: StudentEventType;
    payload: { attemptId?: string };
  }[],
  notes: unknown[] = []
): StudentModelData {
  const reactions: Partial<Record<StudentEventType, number>> = {};
  for (const e of events) {
    reactions[e.type] = (reactions[e.type] ?? 0) + 1;
  }
  // 复核撤销、改判过的证据按复核后的算
  const rows = reviewedAttempts(transactions, events);
  const graded = rows.filter((t) => t.attempt.correct !== undefined);
  return {
    answers: {
      independentCorrect: graded.filter(
        (t) => t.attempt.correct === true && !t.attempt.hinted
      ).length,
      total: graded.length,
    },
    arms: {},
    calibration: calibrate(rows),
    learnRate: BKT.learn,
    notes,
    reactions,
    rebuiltFrom: { events: events.length, transactions: transactions.length },
    style: null,
  };
}
