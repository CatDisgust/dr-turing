import { z } from "zod";
import { auth } from "@/lib/session";
import { chargeTo } from "@/lib/spend";
import { catchUpSessions } from "@/lib/tutor/session";

// 开新对话时前端调一次：之前没点“结束本次学习”的会话在这里补跑复核
export const maxDuration = 300;

const bodySchema = z.object({
  courseId: z.string().max(64).optional(),
  exceptChatId: z.string().uuid(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const session = await auth();
  chargeTo(session.user.id);
  await catchUpSessions({
    exceptChatId: parsed.data.exceptChatId,
    studentId: session.user.id,
  });
  return Response.json({ ok: true });
}
