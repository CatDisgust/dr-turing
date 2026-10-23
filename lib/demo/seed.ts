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
// B：前置答错过、要过提示才勉强做对，在目标点上答错过一次，从他的错答里提出了一个错误想法

export const DEMO_QUESTION = "加锁为什么会死锁？";

// 用户 2026-10-22 定：第 2 课「死锁」，它的前置是「悲观并发控制（加锁）」。
// 原定的加锁本身没有前置（它 part_of 并发控制），A、B 拉不开。按名字和别名找，不认死 id
const TARGET = /死锁|deadlock/i;

export const [DEMO_STUDENT, STUDENT_A, STUDENT_B] = STUDENTS;

export function demoTarget(graph: CourseGraph): KnowledgePoint | null {
  return (
    graph.points.find((p) => TARGET.test(p.name)) ??
    graph.points.find((p) => p.aliases.some((a) => TARGET.test(a))) ??
    null
  );
}

const DAY = 24 * 60 * 60 * 1000;

// B 在死锁上的那次错答，和从这句话里提出来的错误想法（批改时就是这样从学生原话里提的）
const B_ANSWER = "（预置）B 的回答：两个任务都加了锁，所以肯定会死锁";
const B_MISCONCEPTION = "只要用了锁就一定会死锁";

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

  // B：每个前置先答错，要了提示后才答对；目标点上答错一次，记下他的错误想法
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
  b = applyEvidence(
    b,
    graph,
    target.id,
    attempt("seed-b-3", t0 + DAY, {
      correct: false,
      d: 0,
      hinted: true,
      misconception: B_MISCONCEPTION,
      producedStep: false,
      questionKind: "check",
      quote: B_ANSWER,
      type: "check_wrong",
    })
  );
  // 第 1 课也补上历史，图谱上看得出两人的差别；死锁的规划只看它自己、前置和易混点，这些点不碰，A/B 对比不受影响
  const { confusable } = plannerContext(graph, empty, target.id);
  const keep = new Set([
    target.id,
    ...prereqs.map((p) => p.id),
    ...confusable.map((p) => p.id),
  ]);
  const [first] = lessonPoints(graph);
  for (const [i, p] of (first ?? []).filter((q) => !keep.has(q.id)).entries()) {
    const at = t0 - 7 * DAY + i * 60_000;
    // A：多数学过且隔天复习过 → 全亮
    if (i < 20) {
      a = learnFull(a, graph, p, at, "seed-a-l1");
    }
    // B：隔两个学一个，还要提示才答对 → 只到半亮或更低
    if (i % 3 === 0) {
      b = learnHalf(b, graph, p, at, "seed-b-l1", true);
    }
  }

  return {
    a,
    b,
    misconception: B_MISCONCEPTION,
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

// 画面二（D12）：演示学生昨天在「丢失更新」上独立答对了检查题和变式题，已经半亮。
// 今天问到它，规则⑤出题；隔了一夜，出的是复习题，独立答对就全亮（D6：全亮只能靠隔天复习）。
// 只替换这一个点，其他点和学生自己的记录不动；没答完的题清掉，免得接着批改旧题
const SCENE2_TARGET = /丢失更新|lost update/i;

export function scene2Target(graph: CourseGraph): KnowledgePoint | null {
  return (
    graph.points.find((p) => SCENE2_TARGET.test(p.name)) ??
    graph.points.find((p) => p.aliases.some((a) => SCENE2_TARGET.test(a))) ??
    null
  );
}

export function seedScene2(
  graph: CourseGraph,
  state: LearnerState,
  now: Date
): { state: LearnerState; target: KnowledgePoint } | null {
  const target = scene2Target(graph);
  if (!target) {
    return null;
  }
  const yesterday = now.getTime() - DAY;
  return {
    state: replayPoint(graph, state, target.id, [
      attempt("seed-demo-1", yesterday, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "check",
        quote: `（预置）昨天自己讲清了「${target.name}」：两个人同时读到旧值，后写的把先写的盖掉了`,
        type: "check_correct",
      }),
      attempt("seed-demo-1", yesterday + 5 * 60_000, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "variant",
        quote: "（预置）昨天的变式题也独立答对：库存扣减一样会少扣",
        type: "transfer_correct",
      }),
    ]),
    target,
  };
}

// 演示视频的“第二天”（用户 2026-10-23 定：课程内容全程只讲死锁）：
// 把演示学生的「死锁」换成“昨天学过”的样子——很确定却答错、换个讲法后独立答对检查题和变式题，半亮，错误想法已修正。
// 今天再问死锁，和画面二一样出复习题，独立答对就全亮。只替换这一个点，今天在死锁上的真实记录一起换掉
const NEXT_DAY_WRONG = {
  answer: "（预置）昨天的回答：还会。只要加了锁，就可能死锁",
  idea: "只要加锁就会死锁",
};

export function seedNextDay(
  graph: CourseGraph,
  state: LearnerState,
  now: Date
): { state: LearnerState; target: KnowledgePoint } | null {
  const target = demoTarget(graph);
  if (!target) {
    return null;
  }
  const yesterday = now.getTime() - DAY;
  return {
    state: replayPoint(graph, state, target.id, [
      attempt("seed-next-day", yesterday, {
        confidence: "sure",
        correct: false,
        d: 0,
        hinted: false,
        misconception: NEXT_DAY_WRONG.idea,
        producedStep: false,
        questionKind: "check",
        quote: NEXT_DAY_WRONG.answer,
        type: "check_wrong",
      }),
      attempt("seed-next-day", yesterday + 5 * 60_000, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "check",
        quote:
          "（预置）换个讲法后自己讲清了：按同一个顺序加锁，等待绕不成圈，就不会死锁",
        type: "check_correct",
      }),
      attempt("seed-next-day", yesterday + 10 * 60_000, {
        correct: true,
        d: 1,
        hinted: false,
        producedStep: true,
        questionKind: "variant",
        quote: "（预置）昨天的变式题也独立答对：三个事务互相等，一样是死锁",
        type: "transfer_correct",
      }),
    ]),
    target,
  };
}

// 把一个点的记录整份换成给定的证据重放出来；其他点不动，没答完的题清掉，免得接着批改旧题
function replayPoint(
  graph: CourseGraph,
  state: LearnerState,
  kpId: string,
  attempts: Attempt[]
): LearnerState {
  const { [kpId]: _old, ...others } = state.nodes;
  let next: LearnerState = {
    ...state,
    nodes: others,
    pendingQuestion: undefined,
  };
  for (const a of attempts) {
    next = applyEvidence(next, graph, kpId, a);
  }
  return next;
}

// 课程里各课的知识点，按课的顺序；课内先放前置，后放依赖它的点（点亮时先亮前置，看着自然）
export function lessonPoints(graph: CourseGraph): KnowledgePoint[][] {
  const lessons = [...graph.lessons].sort((x, y) => x.index - y.index);
  return lessons.map((lesson) => {
    const points = graph.points.filter((p) => p.lessonId === lesson.id);
    const ids = new Set(points.map((p) => p.id));
    const before = new Map(points.map((p) => [p.id, new Set<string>()]));
    for (const e of graph.edges) {
      if (e.type === "prereq" && ids.has(e.from) && ids.has(e.to)) {
        before.get(e.to)?.add(e.from);
      }
    }
    const ordered: KnowledgePoint[] = [];
    const done = new Set<string>();
    let rest = points;
    while (rest.length > 0) {
      const ready = rest.filter((p) =>
        [...(before.get(p.id) ?? [])].every((id) => done.has(id))
      );
      // 有环就按原顺序放下一个，别卡住
      const next = ready.length > 0 ? ready : rest.slice(0, 1);
      for (const p of next) {
        ordered.push(p);
        done.add(p.id);
      }
      rest = rest.filter((p) => !done.has(p.id));
    }
    return ordered;
  });
}

// 学过并且隔两天复习也独立答对 → 全亮
function learnFull(
  state: LearnerState,
  graph: CourseGraph,
  p: KnowledgePoint,
  at: number,
  session: string
): LearnerState {
  const learned = learnHalf(state, graph, p, at, session, false);
  return applyEvidence(
    learned,
    graph,
    p.id,
    attempt(`${session}-review`, at + 2 * DAY, {
      correct: true,
      d: 1,
      hinted: false,
      producedStep: true,
      questionKind: "review",
      quote: `（预置）隔天复习「${p.name}」独立答对`,
      type: "review_correct",
    })
  );
}

// 检查题和变式题都答对 → 半亮；hinted 时是看了提示才答对的
function learnHalf(
  state: LearnerState,
  graph: CourseGraph,
  p: KnowledgePoint,
  at: number,
  session: string,
  hinted: boolean
): LearnerState {
  const checked = applyEvidence(
    state,
    graph,
    p.id,
    attempt(session, at, {
      correct: true,
      d: hinted ? 0.5 : 1,
      hinted,
      producedStep: !hinted,
      questionKind: "check",
      quote: hinted
        ? `（预置）看了提示后答对「${p.name}」`
        : `（预置）自己讲清了「${p.name}」`,
      type: "check_correct",
    })
  );
  return applyEvidence(
    checked,
    graph,
    p.id,
    attempt(session, at + 5 * 60_000, {
      correct: true,
      d: hinted ? 0.5 : 1,
      hinted,
      producedStep: !hinted,
      questionKind: "variant",
      quote: `（预置）「${p.name}」的变式题也答对了`,
      type: "transfer_correct",
    })
  );
}

// 演示学生的整体起点（用户 2026-10-23 定）：一周前学完第 1 课，这几天在学第 2 课，第 3 课还没开始。
// 第 1 课约 20 全亮、4 半亮；第 2 课 3 全亮、约 9 半亮、2 个答错过（其中一个记下错误想法），
// 死锁不碰（留给“开始学习”），丢失更新由 seedScene2 放成半亮；第 3 课全灰，诊断和画面一从零点亮
const DEMO_WRONG = {
  answer: "（预置）演示学生的回答：加了锁就不会有任何并发问题了",
  idea: "加了锁就不会有任何并发问题",
};

export function seedDemoStudent(
  graph: CourseGraph,
  courseId: string,
  now: Date
): LearnerState {
  let s = emptyLearnerState(DEMO_STUDENT.id, courseId);
  const [l1 = [], l2 = []] = lessonPoints(graph);
  const t1 = now.getTime() - 7 * DAY;
  for (const [i, p] of l1.entries()) {
    if (i < 20) {
      s = learnFull(s, graph, p, t1 + i * 60_000, "seed-demo-l1");
    } else if (i < 24) {
      s = learnHalf(s, graph, p, t1 + i * 60_000, "seed-demo-l1", false);
    }
  }
  const skip = new Set(
    [demoTarget(graph), scene2Target(graph)].flatMap((p) => (p ? [p.id] : []))
  );
  const t2 = now.getTime() - 3 * DAY;
  for (const [i, p] of l2.filter((q) => !skip.has(q.id)).entries()) {
    const at = t2 + i * 60_000;
    if (i < 3) {
      s = learnFull(s, graph, p, at, "seed-demo-l2");
    } else if (i < 12) {
      s = learnHalf(s, graph, p, at, "seed-demo-l2", false);
    } else if (i < 14) {
      s = applyEvidence(
        s,
        graph,
        p.id,
        attempt("seed-demo-l2", at, {
          correct: false,
          d: 0,
          hinted: false,
          producedStep: false,
          questionKind: "check",
          ...(i === 12
            ? { misconception: DEMO_WRONG.idea, quote: DEMO_WRONG.answer }
            : { quote: `（预置）「${p.name}」的题答错了` }),
          type: "check_wrong",
        })
      );
    }
  }
  return s;
}
