import { describe, expect, it } from "vitest";
import type { LearnerState } from "@/lib/types";
import {
  emptyEngagement,
  engagementFromEvents,
  engagementLow,
  engagementOf,
  nextTurn,
  recordEvent,
  signals,
} from "../events";
import { emptyLearnerState } from "../update";

// 学生建模方案 A：W、B 按轮次指数衰减，半衰期 4 轮，W ≥ 2 算偏低

const at = (
  turn: number,
  ...types: LearnerState["engagement"]["recent"][number]["type"][]
) => types.map((type) => ({ turn, type }));

describe("W、B 衰减", () => {
  it("同一轮的事件各算 1；4 轮后剩一半", () => {
    const now = { recent: at(10, "give_up", "skip"), turn: 10 };
    expect(signals(now).W).toBeCloseTo(2);
    expect(signals({ ...now, turn: 14 }).W).toBeCloseTo(1);
  });

  it("只有负面事件算 W；还是不懂、太抽象算 B；点赞、追问都不算", () => {
    const e = {
      recent: at(
        5,
        "thumbs_down",
        "still_lost",
        "too_abstract",
        "thumbs_up",
        "asked_followup"
      ),
      turn: 5,
    };
    expect(signals(e)).toEqual({ B: 2, W: 1 });
  });

  it("放弃两次就偏低，过两轮不说话也还偏低不了：2 × 0.5^(2/4) ≈ 1.41", () => {
    const e = { recent: at(3, "give_up", "give_up"), turn: 3 };
    expect(engagementLow(e)).toBe(true);
    expect(engagementLow({ ...e, turn: 5 })).toBe(false);
  });
});

describe("记事件", () => {
  it("每条消息算一轮，事件记在当前轮", () => {
    let s = nextTurn(nextTurn(emptyLearnerState("u", "c")));
    s = recordEvent(s, "skip");
    expect(s.engagement).toEqual({
      recent: [{ turn: 2, type: "skip" }],
      turn: 2,
    });
  });

  it("分量已经可以忽略的旧事件从状态里丢掉", () => {
    let s = recordEvent(emptyLearnerState("u", "c"), "give_up");
    for (let i = 0; i < 30; i += 1) {
      s = nextTurn(s);
    }
    s = recordEvent(s, "skip");
    expect(s.engagement.recent).toEqual([{ turn: 30, type: "skip" }]);
  });

  it("旧数据还是累计次数：当作从零开始", () => {
    const old = {
      engagement: { giveUps: 5, justTellMe: 0, skippedQuestions: 0 },
    } as unknown as LearnerState;
    expect(engagementOf(old)).toEqual(emptyEngagement());
    expect(nextTurn(old).engagement).toEqual({ recent: [], turn: 1 });
  });
});

describe("从 Event 表重算", () => {
  it("和一轮轮记下来的结果一样", () => {
    let s = emptyLearnerState("u", "c");
    const log: { turn: number; type: "give_up" | "still_lost" }[] = [];
    for (let i = 1; i <= 12; i += 1) {
      s = nextTurn(s);
      if (i % 3 === 0) {
        s = recordEvent(s, "give_up");
        log.push({ turn: i, type: "give_up" });
      }
      if (i === 11) {
        s = recordEvent(s, "still_lost");
        log.push({ turn: i, type: "still_lost" });
      }
    }
    expect(engagementFromEvents(log.toReversed(), 12)).toEqual(s.engagement);
  });
});
