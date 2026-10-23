import { getLearnerStatesByStudent } from "@/lib/db/queries";
import { computeAbilities } from "@/lib/learner/abilities";
import { auth } from "@/lib/session";
import { loadPersonal } from "@/lib/tutor/personal-store";

// 当前学生的个人图谱：课外概念 + 三项底层能力（每次从证据现算，不存）
export async function GET() {
  const session = await auth();
  const studentId = session.user.id;
  const [{ graph }, states] = await Promise.all([
    loadPersonal(studentId),
    getLearnerStatesByStudent({ studentId }),
  ]);
  return Response.json({
    abilities: computeAbilities(states),
    concepts: graph.concepts.filter((c) => c.status === "unanchored"),
  });
}
