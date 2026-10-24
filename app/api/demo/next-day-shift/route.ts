import { dumpStudent, restoreStudent } from "@/lib/db/queries";
import { SHOW_STUDENT } from "@/lib/demo/seed";
import { dumpCounts, shiftDump } from "@/lib/demo/snapshot";

// 模拟第二天（用户 2026-10-24 定）：把产品演示学生的全部记录整体往前挪 hours 小时（默认 24），
// 镜头 5、6 里真实的作答和对话都保留，只是变成了“昨天”的；视频里照样标“模拟第二天”
export async function POST(request: Request) {
  try {
    const { hours = 24 } = (await request.json().catch(() => ({}))) as {
      hours?: number;
    };
    if (!(Number.isFinite(hours) && hours > 0 && hours <= 24 * 30)) {
      return Response.json(
        { error: "hours 要在 0 到 720 之间" },
        { status: 400 }
      );
    }
    const dump = await dumpStudent({ studentId: SHOW_STUDENT.id });
    const shifted = shiftDump(dump, -hours * 60 * 60 * 1000);
    await restoreStudent({ dump: shifted, studentId: SHOW_STUDENT.id });
    return Response.json({ counts: dumpCounts(dump), hours, ok: true });
  } catch (error) {
    console.error("[next-day-shift] 失败", error);
    return Response.json(
      {
        error: `挪时间失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
