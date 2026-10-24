import {
  getLearnerStatesByStudent,
  getSpend,
  listCourses,
} from "@/lib/db/queries";
import { reviewDue } from "@/lib/learner/question";
import { OWN_LIMITS, uploadBlock } from "@/lib/own-course";
import { auth } from "@/lib/session";

// 侧边栏「我的课」：管理员加的公开课 + 这个同学自己传的课，
// 每门课带上这个学生现在有几个点该复习了。试用账号再带上还能不能传课
export async function GET() {
  const session = await auth();
  const [courses, states] = await Promise.all([
    listCourses({ viewerId: session.user.id }),
    getLearnerStatesByStudent({ studentId: session.user.id }),
  ]);
  const now = new Date().toISOString();
  const { invite } = session;
  const own = invite
    ? {
        block: uploadBlock({
          budgetCents: invite.budgetCents,
          courseLimit: invite.courseLimit,
          generations: invite.generations,
          own: courses.filter((c) => c.mine).length,
          spentMicroUsd: await getSpend(session.user.id),
        }),
        count: courses.filter((c) => c.mine).length,
        limit: invite.courseLimit,
        limits: OWN_LIMITS,
      }
    : null;
  return Response.json({
    courses: courses.map((course) => {
      const state = states.find((s) => s.courseId === course.id);
      return {
        ...course,
        due: state
          ? Object.values(state.nodes).filter((n) => reviewDue(n, now)).length
          : 0,
      };
    }),
    own,
  });
}
