import { z } from "zod";
import { auth } from "@/lib/session";
import { endSession } from "@/lib/tutor/session";

// 学生点“结束本次学习”：会后复核 + 会话报告。复核用 high，给足时间
export const maxDuration = 300;

const bodySchema = z.object({ courseId: z.string().max(64) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const session = await auth();
  try {
    const report = await endSession({
      chatId,
      courseId: parsed.data.courseId,
      studentId: session.user.id,
    });
    if (!report) {
      return Response.json({ error: "没有这个对话" }, { status: 404 });
    }
    return Response.json({ report });
  } catch (error) {
    console.error("end session failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
