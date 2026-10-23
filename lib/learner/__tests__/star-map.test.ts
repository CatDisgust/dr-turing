import { describe, expect, it } from "vitest";
import type { CourseGraph, PersonalGraph } from "@/lib/types";
import { buildStarMap, mergeCandidates } from "../star-map";
import { applyEvidence, emptyLearnerState } from "../update";

const point = (id: string, name: string, aliases: string[] = []) => ({
  aliases,
  checkQuestions: ["q"],
  definition: `${name}的定义`,
  id,
  kind: "concept" as const,
  lessonId: "l2",
  name,
  sources: [],
  status: "auto" as const,
});

const course: CourseGraph = {
  builtAt: "",
  courseId: "comp5348",
  edges: [
    { from: "kp_lock", status: "confirmed", to: "kp_dead", type: "prereq" },
    { from: "kp_cc", status: "confirmed", to: "kp_lock", type: "prereq" },
  ],
  lessons: [{ fileIds: [], id: "l2", index: 2, title: "并发" }],
  name: "COMP5348",
  points: [
    point("kp_cc", "并发控制"),
    point("kp_lock", "锁", ["lock"]),
    point("kp_dead", "死锁", ["deadlock"]),
  ],
};

const personal = (over: Partial<PersonalGraph> = {}): PersonalGraph => ({
  concepts: [
    {
      aliases: [],
      createdAt: "2026-10-20T00:00:00Z",
      definition: "外壳",
      evidence: [
        {
          at: "2026-10-20T00:00:00Z",
          quote: "什么叫做harness",
          sessionId: "s1",
        },
      ],
      id: "pc_1",
      level: "touched",
      name: "Agent harness",
      status: "unanchored",
    },
    {
      aliases: [],
      createdAt: "2026-10-21T00:00:00Z",
      definition: "锁住",
      evidence: [
        { at: "2026-10-21T00:00:00Z", quote: "lock 是啥", sessionId: "s2" },
      ],
      id: "pc_2",
      level: "touched",
      name: "lock",
      status: "unanchored",
    },
    {
      aliases: [],
      createdAt: "2026-10-21T00:00:00Z",
      definition: "x",
      evidence: [],
      id: "pc_3",
      level: "touched",
      name: "记错的",
      status: "invalidated",
    },
  ],
  courseMentions: {
    kp_dead: [
      {
        at: "2026-10-23T00:00:00Z",
        quote: "加锁为什么会死锁？",
        sessionId: "s3",
      },
    ],
  },
  log: [],
  studentId: "stu",
  ...over,
});

function stateWithLock() {
  const state = emptyLearnerState("stu", "comp5348");
  return applyEvidence(state, course, "kp_lock", {
    at: "2026-10-22T00:00:00Z",
    correct: true,
    d: 1,
    hinted: false,
    id: "a1",
    producedStep: true,
    provisional: false,
    quote: "锁就是厕所门上那个有人无人",
    sessionId: "s2",
    source: "slow",
    turnId: "t1",
    type: "check_correct",
  });
}

describe("我的星图", () => {
  it("只画碰过的：答过题的、提到过的课内知识点，加没作废的课外概念", () => {
    const map = buildStarMap({
      courses: [course],
      personal: personal(),
      states: [stateWithLock()],
    });
    expect(map.graph.points.map((p) => p.id).sort()).toEqual([
      "kp_dead",
      "kp_lock",
      "pc_1",
      "pc_2",
    ]);
    expect(map.graph.lessons.map((l) => l.title)).toEqual(["COMP5348", "课外"]);
    // 先修边两头都在图上才画
    expect(map.graph.edges).toEqual([course.edges[0]]);
    expect(map.stars.kp_lock.where).toBe("COMP5348 · 第 2 课");
    expect(map.stars.kp_lock.evidence[0]).toMatchObject({
      correct: true,
      how: "answer",
    });
    expect(map.stars.kp_dead.evidence[0]).toMatchObject({ how: "mention" });
    expect(map.stars.pc_1).toMatchObject({ kind: "outside", where: "课外" });
    expect(map.catalog.map((c) => c.id)).toEqual([
      "kp_cc",
      "kp_lock",
      "kp_dead",
    ]);
  });

  it("合并候选：别的课外概念都列；课内知识点只列名字像的；课内星没有候选", () => {
    const map = buildStarMap({
      courses: [course],
      personal: personal(),
      states: [stateWithLock()],
    });
    // “lock”字面上也像“deadlock”，一起列出来让学生挑；“并发控制”不像，不列
    expect(mergeCandidates(map, "pc_2").map((c) => c.id)).toEqual([
      "kp_lock",
      "kp_dead",
      "pc_1",
    ]);
    expect(mergeCandidates(map, "kp_lock")).toEqual([]);
  });

  it("并进知识点的课外概念挂在那颗课内星上，可以拆开", () => {
    const map = buildStarMap({
      courses: [course],
      personal: personal({
        anchored: { kp_lock: [{ from: "pc_9", mergeId: "m1", name: "锁头" }] },
      }),
      states: [stateWithLock()],
    });
    expect(map.stars.kp_lock.merged).toEqual([
      { from: "pc_9", mergeId: "m1", name: "锁头" },
    ]);
  });
});
