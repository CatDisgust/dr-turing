import { getPersonalGraph, savePersonalGraph } from "@/lib/db/queries";
import { removeConcept } from "@/lib/learner/personal";
import { auth } from "@/lib/session";

// 学生删掉一个记错的课外概念
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  const personal = await getPersonalGraph({ studentId: session.user.id });
  if (!personal) {
    return Response.json({ ok: true });
  }
  await savePersonalGraph({
    graph: removeConcept(personal, id, new Date().toISOString()),
  });
  return Response.json({ ok: true });
}
