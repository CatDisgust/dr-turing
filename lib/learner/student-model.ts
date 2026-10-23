import type { Attempt, StudentEventType, StudentModelData } from "@/lib/types";
import { BKT } from "./config";

// 学生模型（学生建模方案 F）：从两张只追加的表——作答 Transaction、反应 Event——整份重算。
// notes 是 Claude 写的文字，没法重算，原样带过来

export function rebuildStudentModel(
  transactions: readonly { attempt: Attempt }[],
  events: readonly { type: StudentEventType }[],
  notes: unknown[] = []
): StudentModelData {
  const reactions: Partial<Record<StudentEventType, number>> = {};
  for (const e of events) {
    reactions[e.type] = (reactions[e.type] ?? 0) + 1;
  }
  const graded = transactions.filter((t) => t.attempt.correct !== undefined);
  return {
    answers: {
      independentCorrect: graded.filter(
        (t) => t.attempt.correct === true && !t.attempt.hinted
      ).length,
      total: graded.length,
    },
    arms: {},
    calibration: null,
    learnRate: BKT.learn,
    notes,
    reactions,
    rebuiltFrom: { events: events.length, transactions: transactions.length },
    style: null,
  };
}
