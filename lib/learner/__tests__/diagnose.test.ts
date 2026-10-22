import { describe, expect, it } from "vitest";
import type { Attempt, CourseGraph, KnowledgePoint } from "@/lib/types";
import {
  diagnosisTargets,
  lessonStart,
  MAX_DIAGNOSIS,
  parseLessonRequest,
} from "../diagnose";
import { applyEvidence, emptyLearnerState } from "../update";

// D10：识别“我要学第 N 课”；沿先修边往回找前置；最多 3 道；开讲点能接上答对的前置

const point = (
  id: string,
  lessonId: string,
  questions = 1
): KnowledgePoint => ({
  aliases: [],
  checkQuestions: Array.from({ length: questions }, (_, i) => `${id} 问${i}`),
  definition: id,
  id,
  kind: "concept",
  lessonId,
  name: id,
  sources: [],
  status: "auto",
});

const pre = (from: string, to: string) => ({
  from,
  status: "tentative" as const,
  to,
  type: "prereq" as const,
});

// l1: a → b；l2: c → d；l3: e、f、g。b → e、d → e、d → f、a → f（a 是 f 的一跳），c 只在两跳
const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [
    pre("a", "b"),
    pre("c", "d"),
    pre("b", "e"),
    pre("d", "e"),
    pre("d", "f"),
    pre("a", "f"),
    pre("e", "g"),
    pre("x", "f"),
  ],
  lessons: [
    { fileIds: [], id: "l1", index: 1, title: "COMP5348_W1" },
    { fileIds: [], id: "l2", index: 2, title: "COMP5348_W2" },
    { fileIds: [], id: "l3", index: 3, title: "COMP5348_W3" },
  ],
  name: "c",
  points: [
    point("a", "l1"),
    point("b", "l1"),
    point("c", "l2"),
    point("d", "l2"),
    point("e", "l3"),
    point("f", "l3"),
    point("g", "l3"),
    point("x", "l2", 0), // 没有检查题，问不了
  ],
};

describe("parseLessonRequest", () => {
  it.each([
    ["我要学第 3 课", "l3"],
    ["我想学第三讲", "l3"],
    ["I want to learn COMP5348 W3", "l3"],
    ["想学 week 2", "l2"],
    ["学习第1课", "l1"],
  ])("%s → %s", (text, id) => {
    expect(parseLessonRequest(text, graph)?.id).toBe(id);
  });

  it.each([
    "第 3 课里的锁是什么意思？",
    "我要学第 9 课",
    "Lost updates 是什么意思？",
  ])("%s 不算", (text) => {
    expect(parseLessonRequest(text, graph)).toBeNull();
  });
});

describe("diagnosisTargets", () => {
  it("只挑课外、两跳以内、没证据、有检查题的前置，一跳的排前面，最多 3 个", () => {
    const state = emptyLearnerState("s", "c");
    const ids = diagnosisTargets(graph, state, "l3").map((p) => p.id);
    // d 被 e、f 一跳依赖（4 分）；b、a 一跳 + 两跳；c 两跳；x 没有检查题
    expect(ids).toHaveLength(MAX_DIAGNOSIS);
    expect(ids[0]).toBe("d");
    expect(ids).not.toContain("x");
    expect(ids).not.toContain("e");
  });

  it("已经有答题证据的前置不再问", () => {
    let state = emptyLearnerState("s", "c");
    const attempt: Attempt = {
      at: "2026-10-22T00:00:00.000Z",
      correct: true,
      d: 1,
      hinted: false,
      id: "t1",
      producedStep: true,
      provisional: false,
      quote: "q",
      sessionId: "old",
      source: "fast",
      turnId: "u1",
      type: "check_correct",
    };
    state = applyEvidence(state, graph, "d", attempt);
    expect(diagnosisTargets(graph, state, "l3").map((p) => p.id)).not.toContain(
      "d"
    );
  });

  it("第 1 课没有课外前置：不用诊断", () => {
    expect(diagnosisTargets(graph, emptyLearnerState("s", "c"), "l1")).toEqual(
      []
    );
  });
});

describe("lessonStart", () => {
  it("开讲点是两跳内已掌握前置最多的点", () => {
    let state = emptyLearnerState("s", "c");
    for (const [i, id] of ["x"].entries()) {
      state = applyEvidence(state, graph, id, {
        at: `2026-10-22T0${i}:00:00.000Z`,
        correct: true,
        d: 1,
        hinted: false,
        id: `t${id}`,
        producedStep: true,
        provisional: true,
        quote: "q",
        sessionId: "s1",
        source: "fast",
        turnId: `u${id}`,
        type: "check_correct",
      });
    }
    // 只有 f 依赖已掌握的 x；e 虽然没有课内前置也排在后面
    expect(lessonStart(graph, state, "l3")?.id).toBe("f");
  });

  it("都没掌握时挑没有课内前置的第一个点", () => {
    expect(lessonStart(graph, emptyLearnerState("s", "c"), "l3")?.id).toBe("e");
  });
});
