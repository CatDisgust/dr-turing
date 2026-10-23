import { describe, expect, it } from "vitest";
import type { Attempt } from "@/lib/types";
import { BKT } from "../config";
import { rebuildStudentModel } from "../student-model";

const attempt = (
  fields: Partial<Attempt>
): { attempt: Attempt; kpId: string } => ({
  attempt: {
    at: "2026-10-23T00:00:00Z",
    d: 1,
    hinted: false,
    id: "a",
    producedStep: false,
    provisional: false,
    quote: "",
    sessionId: "s",
    source: "fast",
    turnId: "t",
    type: "check_correct",
    ...fields,
  },
  kpId: "kp",
});

// 学生建模方案 F：学生模型整份从 Transaction + Event 重算
describe("rebuildStudentModel", () => {
  it("没有记录：全局默认值", () => {
    expect(rebuildStudentModel([], [])).toEqual({
      answers: { independentCorrect: 0, total: 0 },
      arms: {},
      calibration: null,
      learnRate: BKT.learn,
      notes: [],
      reactions: {},
      rebuiltFrom: { events: 0, transactions: 0 },
      style: null,
    });
  });

  it("数各种反应和答题；没批改的不算答题；笔记原样保留", () => {
    const model = rebuildStudentModel(
      [
        attempt({ correct: true }),
        attempt({ correct: true, hinted: true }),
        attempt({ correct: false, type: "check_wrong" }),
        attempt({ type: "said_understood" }),
      ],
      [
        { payload: {}, type: "give_up" },
        { payload: {}, type: "give_up" },
        { payload: {}, type: "thumbs_up" },
      ],
      ["他先看例子"]
    );
    expect(model.answers).toEqual({ independentCorrect: 1, total: 3 });
    expect(model.reactions).toEqual({ give_up: 2, thumbs_up: 1 });
    expect(model.notes).toEqual(["他先看例子"]);
    expect(model.rebuiltFrom).toEqual({ events: 3, transactions: 4 });
  });

  it("同样的记录重算两次结果一样", () => {
    const tx = [attempt({ correct: true })];
    const ev = [{ payload: {}, type: "skip" as const }];
    expect(rebuildStudentModel(tx, ev)).toEqual(rebuildStudentModel(tx, ev));
  });
});
