import { getLearnerStatesByStudent, listCourses } from "@/lib/db/queries";
import { reviewDue } from "@/lib/learner/question";
import { auth } from "@/lib/session";

// 侧边栏「我的课」：管理员加的课大家都能选（第 4 步再加学生自己的课），
// 每门课带上这个学生现在有几个点该复习了
export async function GET() {
  const session = await auth();
  const [courses, states] = await Promise.all([
    listCourses(),
    getLearnerStatesByStudent({ studentId: session.user.id }),
  ]);
  const now = new Date().toISOString();
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
  });
}
