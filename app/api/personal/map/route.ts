import { getCourseById, getLearnerStatesByStudent } from "@/lib/db/queries";
import { computeAbilities } from "@/lib/learner/abilities";
import { buildStarMap } from "@/lib/learner/star-map";
import { auth } from "@/lib/session";
import { loadPersonal } from "@/lib/tutor/personal-store";

// 我的星图：这个学生学过、聊过的所有概念，跨所有课（每次现算，不存）
export async function GET() {
  const session = await auth();
  const studentId = session.user.id;
  const [{ graph: personal }, states] = await Promise.all([
    loadPersonal(studentId),
    getLearnerStatesByStudent({ studentId }),
  ]);
  const rows = await Promise.all(
    states.map((s) => getCourseById({ id: s.courseId }))
  );
  const courses = rows.flatMap((row) => (row ? [row.graph] : []));
  return Response.json({
    ...buildStarMap({ courses, personal, states }),
    abilities: computeAbilities(states),
  });
}
