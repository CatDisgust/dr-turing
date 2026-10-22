import { getLearnerState } from "@/lib/db/queries";
import { emptyLearnerState } from "@/lib/learner/update";
import { auth } from "@/lib/session";

// 当前学生在这门课上的状态；还没有就给一份空的
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params;
  const session = await auth();
  const studentId = session.user.id;
  const state =
    (await getLearnerState({ courseId, studentId })) ??
    emptyLearnerState(studentId, courseId);
  return Response.json({ state });
}
