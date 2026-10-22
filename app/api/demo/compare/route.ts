import { getCourseById, getLearnerState } from "@/lib/db/queries";
import { compareRuns } from "@/lib/demo/compare";
import { DEMO_QUESTION, STUDENT_A, STUDENT_B } from "@/lib/demo/seed";
import { planTurn } from "@/lib/learner/planner";
import { classifyQuestion } from "@/lib/tutor/classify";
import { fillPlan } from "@/lib/tutor/plan";
import type { CourseGraph, LearnerState, TutorPlan } from "@/lib/types";

export const maxDuration = 120;

const MAX_RUNS = 5;

// 和对话里同一条路：规则定动作，Claude 填其余字段；只读，不改两人的状态
async function planFor(
  graph: CourseGraph,
  state: LearnerState,
  kpId: string,
  question: string
): Promise<TutorPlan> {
  const sessionId = "compare";
  const rulePlan = planTurn({ graph, kpId, sessionId, state });
  try {
    return await fillPlan({
      graph,
      justTellMe: false,
      rulePlan,
      sessionId,
      state,
      studentText: question,
    });
  } catch (error) {
    console.error("[compare] Claude 填 plan 失败，用规则默认值", error);
    return rulePlan;
  }
}

// 画面三：同一句话，A、B 各出一份规划，连跑几次看方向变不变
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    courseId?: string;
    question?: string;
    runs?: number;
  };
  const courseId = body.courseId ?? "comp5348";
  const question = body.question?.trim() || DEMO_QUESTION;
  const runs = Math.min(MAX_RUNS, Math.max(1, Math.floor(body.runs ?? 1)));

  const course = await getCourseById({ id: courseId });
  if (!course) {
    return Response.json({ error: `没有这门课：${courseId}` }, { status: 404 });
  }
  const [a, b] = await Promise.all([
    getLearnerState({ courseId, studentId: STUDENT_A.id }),
    getLearnerState({ courseId, studentId: STUDENT_B.id }),
  ]);
  if (!(a && b)) {
    return Response.json(
      { error: "还没有写入学生 A、B 的预置数据，先点“写入预置数据”" },
      { status: 409 }
    );
  }
  // 归类和学生无关，问一次就够
  const point = await classifyQuestion(course.graph, question);
  if (!point) {
    return Response.json({ error: "这句话没归到任何知识点" }, { status: 422 });
  }
  const results = await Promise.all(
    Array.from({ length: runs }, async () => {
      const [planA, planB] = await Promise.all([
        planFor(course.graph, a, point.id, question),
        planFor(course.graph, b, point.id, question),
      ]);
      return { a: planA, b: planB };
    })
  );
  const names = Object.fromEntries(
    course.graph.points.map((p) => [p.id, p.name])
  );
  return Response.json({
    names,
    question,
    runs: results,
    target: { id: point.id, name: point.name },
    verdict: compareRuns(results),
  });
}
