import { invalidateDraft } from "@/lib/learner/personal";
import { auth } from "@/lib/session";
import { appendPersonal } from "@/lib/tutor/personal-store";

// 学生说这个课外概念记错了：记一条“记错”进日志（学生给的证据），不真删
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  await appendPersonal(session.user.id, null, [
    invalidateDraft(id, "学生说记错了"),
  ]);
  return Response.json({ ok: true });
}
