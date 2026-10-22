import { HALF_M } from "@/lib/learner/config";
import { plannerContext } from "@/lib/learner/context";
import { applyEvidence, emptyLearnerState } from "@/lib/learner/update";
import { STUDENTS } from "@/lib/students";
import type {
  Attempt,
  CourseGraph,
  KnowledgePoint,
  LearnerState,
} from "@/lib/types";

// 画面三（D11）的预置学生：A、B 问同一句话，规划不一样。
// 两人的历史都是按真实的证据一条条喂给引擎重放出来的，M、O、H 全由引擎算，不手填。
// A：前置都独立答对过、隔天也还会，求助少，爱自己推；
// B：前置答错过、要过提示才勉强做对，在目标点上答错过一次、错法像已知误解

export const DEMO_QUESTION = "加锁为什么能解决并发冲突？";

// 用户 2026-10-22 定：第 2 课「悲观并发控制（加锁）」。按名字和别名找，不认死 id
const TARGET = /悲观并发|加锁|pessimistic|locking/i;

export const [, STUDENT_A, STUDENT_B] = STUDENTS;

export function demoTarget(graph: CourseGraph): KnowledgePoint | null {
  return (
    graph.points.find((p) => TARGET.test(p.name)) ??
    graph.points.find((p) => p.aliases.some((a) => TARGET.test(a))) ??
    null
  );
}

const DAY = 24 * 60 * 60 * 1000;

function attempt(
  sessionId: string,
  at: number,
  fields: Pick<Attempt, "type" | "d" | "hinted" | "producedStep" | "quote"> &
    Partial<Attempt>
): Attempt {
  const iso = new Date(at).toISOString();
  return {
    at: iso,
    id: `${sessionId}-${at}-${fields.type}`,
    provisional: false,
    sessionId,
    source: "slow",
    turnId: `${sessionId}-${at}`,
    ...fields,
  };
}

export type DemoSeed = {
  target: KnowledgePoint;
  prereqs: { id: string; name: string }[];
  misconception?: string;
  a: LearnerState;
  b: LearnerState;
};

export function seedStudents(
  graph: CourseGraph,
  courseId: string,
  now: Date
): DemoSeed | null {
  const target = demoTarget(graph);
  if (!target) {
    return null;
  }
  const empty = emptyLearnerState("", courseId);
  const { prereqs } = plannerContext(graph, empty, target.id);
  const t0 = now.getTime() - 7 * DAY;

  // A：每个前置一周前独立答对、自己讲出一步，两天后隔天复习又独立答对
  let a: LearnerState = { ...empty, studentId: STUDENT_A.id };
  for (const [i, p] of prereqs.entries()) {
    const at = t0 + i * 60_000;
    a = applyEvidence(
      a,
      graph,
      p.id,
      attempt("seed-a-1", at, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "check",
        quote: `（预置）A 自己解释了「${p.name}」并举了例子`,
        type: "check_correct",
      })
    );
    a = applyEvidence(
      a,
      graph,
      p.id,
      attempt("seed-a-2", at + 2 * DAY, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "review",
        quote: `（预置）A 隔天复习「${p.name}」独立答对`,
        type: "review_correct",
      })
    );
  }

  // B：每个前置先答错，要了提示后才答对；目标点上答错一次，错法对上建图时写的第一条误解
  let b: LearnerState = { ...empty, studentId: STUDENT_B.id };
  for (const [i, p] of prereqs.entries()) {
    const at = t0 + i * 60_000;
    b = applyEvidence(
      b,
      graph,
      p.id,
      attempt("seed-b-1", at, {
        correct: false,
        d: 0,
        hinted: true,
        producedStep: false,
        questionKind: "check",
        quote: `（预置）B 答「${p.name}」的题说“不太清楚”`,
        type: "check_wrong",
      })
    );
    b = applyEvidence(
      b,
      graph,
      p.id,
      attempt("seed-b-2", at + 30_000, {
        correct: true,
        d: 0.5,
        hinted: true,
        producedStep: false,
        questionKind: "check",
        quote: `（预置）B 看了提示后照着答对「${p.name}」`,
        type: "check_correct",
      })
    );
    b = applyEvidence(
      b,
      graph,
      p.id,
      attempt("seed-b-4", at + 2 * DAY, {
        correct: false,
        d: 0,
        hinted: false,
        producedStep: false,
        questionKind: "review",
        quote: `（预置）B 隔天复习「${p.name}」没答上来`,
        type: "check_wrong",
      })
    );
  }
  const [misconception] = target.misconceptions;
  b = applyEvidence(
    b,
    graph,
    target.id,
    attempt("seed-b-3", t0 + DAY, {
      correct: false,
      d: 0,
      hinted: true,
      misconceptionId: misconception ? "m0" : undefined,
      producedStep: false,
      questionKind: "check",
      quote: misconception
        ? `（预置）B 的回答：${misconception}`
        : "（预置）B 答错了加锁的题",
      type: "check_wrong",
    })
  );
  // 预置历史是一周前的事，投入度按现在算
  a = { ...a, engagement: { giveUps: 0, justTellMe: 0, skippedQuestions: 0 } };
  b = { ...b, engagement: { giveUps: 0, justTellMe: 0, skippedQuestions: 0 } };

  return {
    a,
    b,
    misconception,
    prereqs: prereqs.map((p) => ({ id: p.id, name: p.name })),
    target,
  };
}

// 自检：A 的前置都到半亮、B 的都没到
export function seedSummary(seed: DemoSeed) {
  const m = (s: LearnerState, id: string) => s.nodes[id]?.M ?? 0;
  return seed.prereqs.map((p) => ({
    ...p,
    aM: m(seed.a, p.id),
    aOwned: m(seed.a, p.id) >= HALF_M,
    bM: m(seed.b, p.id),
    bOwned: m(seed.b, p.id) >= HALF_M,
  }));
}
