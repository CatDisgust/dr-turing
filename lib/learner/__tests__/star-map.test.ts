import { describe, expect, it } from "vitest";
import type { CourseGraph, PersonalGraph } from "@/lib/types";
import {
  buildStarMap,
  CLUSTER,
  collapseCourses,
  mergeCandidates,
} from "../star-map";
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

  it("两门课撞号时先到先得，不把前一门课的星盖掉", () => {
    const other: CourseGraph = {
      ...course,
      courseId: "old101",
      edges: [],
      name: "旧测试课",
      points: [point("kp_lock", "进程")],
    };
    const otherState = applyEvidence(
      emptyLearnerState("stu", "old101"),
      other,
      "kp_lock",
      {
        at: "2026-10-22T00:00:00Z",
        correct: true,
        d: 1,
        hinted: false,
        id: "a2",
        producedStep: true,
        provisional: false,
        quote: "进程就是跑起来的程序",
        sessionId: "s4",
        source: "slow",
        turnId: "t2",
        type: "check_correct",
      }
    );
    const map = buildStarMap({
      courses: [course, other],
      personal: personal(),
      states: [stateWithLock(), otherState],
    });
    expect(map.stars.kp_lock.name).toBe("锁");
    expect(map.graph.points.filter((p) => p.id === "kp_lock")).toHaveLength(1);
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

  it("回链：出处标上哪次对话、哪门课；同一次对话里出现过的算一起出现", () => {
    const map = buildStarMap({
      chats: { s2: "并发控制入门" },
      courses: [course],
      personal: personal(),
      states: [stateWithLock()],
    });
    expect(map.stars.pc_2.evidence[0]).toMatchObject({
      chat: "并发控制入门",
      course: "COMP5348",
    });
    expect(map.stars.kp_dead.evidence[0].chat).toBeUndefined();
    expect(map.stars.pc_2.related).toEqual(["kp_lock"]);
    expect(map.related.kp_lock).toEqual([{ kind: "together", to: "pc_2" }]);
    expect(map.stars.pc_1.related).toEqual([]);
  });

  it("课外概念只在一次对话里出现过就暗着，两次对话以上才亮", () => {
    const base = personal();
    const once = buildStarMap({
      courses: [course],
      personal: base,
      states: [],
    });
    expect(once.lights.pc_1).toBe("gray");
    expect(once.stars.pc_1.light).toBe("gray");
    const [harness, ...rest] = base.concepts;
    const twice = buildStarMap({
      courses: [course],
      personal: {
        ...base,
        concepts: [
          {
            ...harness,
            evidence: [
              ...harness.evidence,
              {
                at: "2026-10-22T00:00:00Z",
                quote: "harness 管循环",
                sessionId: "s4",
              },
            ],
          },
          ...rest,
        ],
      },
      states: [],
    });
    expect(twice.lights.pc_1).toBe("half");
  });

  it("意思上的关系两头都看得到，说法各自顺着说；线画成实线，盖过一起出现", () => {
    const map = buildStarMap({
      courses: [course],
      personal: personal({
        links: [
          { from: "pc_2", how: "part_of", id: "k1", to: "kp_lock", why: "" },
          { from: "pc_1", how: "prereq", id: "k2", to: "kp_cc", why: "" },
        ],
      }),
      states: [stateWithLock()],
    });
    expect(map.stars.pc_2.links).toEqual([
      { label: "是「锁」的一部分", linkId: "k1", name: "锁", to: "kp_lock" },
    ]);
    expect(map.stars.kp_lock.links[0].label).toBe("「lock」是它的一部分");
    // 并发控制不在图上（没碰过）：详情里列，线不画
    expect(map.stars.pc_1.links[0].label).toBe("要先懂「并发控制」");
    expect(map.related.pc_1).toEqual([]);
    expect(map.related.pc_2).toEqual([
      { kind: "link", label: "是锁的一部分", to: "kp_lock" },
    ]);
  });

  it("课内每门课先收成一团：只剩一颗星云，连过去的线改连星云；展开后照旧", () => {
    const map = buildStarMap({
      courses: [course],
      personal: personal(),
      states: [stateWithLock()],
    });
    const folded = collapseCourses(map, new Set());
    const cloud = `${CLUSTER}course:comp5348`;
    expect(folded.graph.points.map((p) => p.id)).toEqual([
      cloud,
      "pc_1",
      "pc_2",
    ]);
    expect(folded.graph.points[0].name).toBe("点开看 2 个知识点");
    expect(folded.graph.lessons[0].title).toBe(
      "COMP5348 · 全亮 0 · 半亮 1 / 2"
    );
    expect(folded.graph.edges).toEqual([]);
    expect(folded.related.pc_2).toEqual([{ kind: "together", to: cloud }]);
    expect(folded.related.kp_lock).toBeUndefined();
    const open = collapseCourses(map, new Set(["course:comp5348"]));
    expect(open.graph.points).toHaveLength(4);
  });
});
