import { describe, expect, it } from "vitest";
import { dumpCounts, type StudentDump, shiftDump } from "../snapshot";

// 模拟第二天：整份记录往前挪一天，时间都挪、别的不动

const DAY = 24 * 3600 * 1000;

const dump = (): StudentDump => ({
  chats: [
    {
      createdAt: "2026-10-24T08:00:00.000Z",
      id: "c1",
      reviewedAt: null,
      title: "为什么会死锁",
    },
  ],
  conceptEvents: [],
  events: [],
  learnerStates: [
    {
      state: {
        nodes: {
          deadlock: {
            attempts: [{ at: "2026-10-24T08:05:00.000Z", correct: false }],
            repetition: {
              lastReviewAt: 1_792_829_100,
              lastScheduledAt: null,
              nextReviewAt: 1_792_915_500,
              reviewCount: 1,
            },
          },
        },
      },
      updatedAt: "2026-10-24T08:06:00.000Z",
    },
  ],
  messages: [
    {
      createdAt: "2026-10-24T08:01:00.000Z",
      parts: [{ text: "2026-10-24 是今天", type: "text" }],
    },
  ],
  personalGraphs: [],
  studentModels: [],
  transactions: [],
  votes: [],
});

describe("shiftDump", () => {
  it("把 ISO 时间和复习调度的秒数一起往前挪", () => {
    const out = shiftDump(dump(), -DAY);
    expect(out.chats[0].createdAt).toBe("2026-10-23T08:00:00.000Z");
    expect(out.learnerStates[0].updatedAt).toBe("2026-10-23T08:06:00.000Z");
    const node = (out.learnerStates[0].state as any).nodes.deadlock;
    expect(node.attempts[0].at).toBe("2026-10-23T08:05:00.000Z");
    expect(node.repetition.lastReviewAt).toBe(1_792_829_100 - 86_400);
    expect(node.repetition.nextReviewAt).toBe(1_792_915_500 - 86_400);
  });

  it("其他值原样：null、普通数字、不是完整时间的文字", () => {
    const out = shiftDump(dump(), -DAY);
    const rep = (out.learnerStates[0].state as any).nodes.deadlock.repetition;
    expect(rep.lastScheduledAt).toBeNull();
    expect(rep.reviewCount).toBe(1);
    expect(out.chats[0].reviewedAt).toBeNull();
    expect(out.chats[0].title).toBe("为什么会死锁");
    expect((out.messages[0].parts as any)[0].text).toBe("2026-10-24 是今天");
  });

  it("不改原对象，挪回去还是原样", () => {
    const original = dump();
    const back = shiftDump(shiftDump(original, -DAY), DAY);
    expect(back).toEqual(dump());
    expect(original).toEqual(dump());
  });

  it("dumpCounts 数每张表几行", () => {
    expect(dumpCounts(dump())).toMatchObject({
      chats: 1,
      learnerStates: 1,
      messages: 1,
      votes: 0,
    });
  });
});
