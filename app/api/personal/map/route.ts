import {
  getChatTitles,
  getCourseById,
  getLearnerStatesByStudent,
} from "@/lib/db/queries";
import { computeAbilities } from "@/lib/learner/abilities";
import { buildStarMap } from "@/lib/learner/star-map";
import { auth } from "@/lib/session";
import { loadPersonal } from "@/lib/tutor/personal-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // 回链要对话标题：答题、提到、聊到用过的对话；会话 id 都是 uuid，别的（预置数据）不查
  const ids = new Set(
    [
      ...states.flatMap((s) =>
        Object.values(s.nodes).flatMap((n) =>
          n.attempts.map((x) => x.sessionId)
        )
      ),
      ...Object.values(personal.courseMentions ?? {}).flatMap((ms) =>
        ms.map((m) => m.sessionId)
      ),
      ...personal.concepts.flatMap((c) => c.evidence.map((e) => e.sessionId)),
    ].filter((id) => UUID.test(id))
  );
  const chats = await getChatTitles({ ids: [...ids], userId: studentId });
  return Response.json({
    ...buildStarMap({ chats, courses, personal, states }),
    abilities: computeAbilities(states),
  });
}
