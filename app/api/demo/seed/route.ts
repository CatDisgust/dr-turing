import {
  getCourseById,
  getLearnerState,
  saveLearnerState,
} from "@/lib/db/queries";
import {
  DEMO_STUDENT,
  seedScene2,
  seedStudents,
  seedSummary,
} from "@/lib/demo/seed";
import { emptyLearnerState } from "@/lib/learner/update";

// 写入演示用的预置数据：画面三的学生 A、B（覆盖他们在这门课上的状态），
// 画面二演示学生的「丢失更新」（只换这一个点，他别的记录不动）
export async function POST(request: Request) {
  try {
    return await writeSeed(request);
  } catch (error) {
    console.error("[seed] 失败", error);
    return Response.json(
      {
        error: `写入失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

async function writeSeed(request: Request) {
  const { courseId = "comp5348" } = (await request
    .json()
    .catch(() => ({}))) as {
    courseId?: string;
  };
  const course = await getCourseById({ id: courseId });
  if (!course) {
    return Response.json({ error: `没有这门课：${courseId}` }, { status: 404 });
  }
  const seed = seedStudents(course.graph, courseId, new Date());
  if (!seed) {
    return Response.json(
      { error: "图谱里找不到「死锁」这个点" },
      { status: 422 }
    );
  }
  await saveLearnerState({ state: seed.a });
  await saveLearnerState({ state: seed.b });
  const demo =
    (await getLearnerState({ courseId, studentId: DEMO_STUDENT.id })) ??
    emptyLearnerState(DEMO_STUDENT.id, courseId);
  const scene2 = seedScene2(course.graph, demo, new Date());
  if (scene2) {
    await saveLearnerState({ state: scene2.state });
  }
  const scene2Node = scene2?.state.nodes[scene2.target.id];
  return Response.json({
    misconception: seed.misconception ?? null,
    prereqs: seedSummary(seed),
    scene2:
      scene2 && scene2Node
        ? {
            M: scene2Node.M,
            name: scene2.target.name,
            O: scene2Node.O,
          }
        : null,
    target: { id: seed.target.id, name: seed.target.name },
  });
}
