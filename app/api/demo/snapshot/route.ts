import {
  dumpStudent,
  getDemoSnapshot,
  listDemoSnapshots,
  restoreStudent,
  saveDemoSnapshot,
} from "@/lib/db/queries";
import { SHOW_STUDENT } from "@/lib/demo/seed";
import { dumpCounts } from "@/lib/demo/snapshot";

// 产品演示学生的存档和读档（录演示视频用）：每个镜头录完存一份，
// 某一镜不满意就读回前一镜的存档，只重录这一镜。只动产品演示学生
export async function GET() {
  return Response.json({ snapshots: await listDemoSnapshots() });
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[snapshot] 失败", error);
    return Response.json(
      {
        error: `存档失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

async function handle(request: Request) {
  const { action, name } = (await request.json().catch(() => ({}))) as {
    action?: "save" | "load";
    name?: string;
  };
  if (!(name && /^[\w-]{1,64}$/.test(name))) {
    return Response.json(
      { error: "name 只能是字母、数字、- 和 _，最长 64" },
      { status: 400 }
    );
  }
  if (action === "save") {
    const data = await dumpStudent({ studentId: SHOW_STUDENT.id });
    await saveDemoSnapshot({ data, name, studentId: SHOW_STUDENT.id });
    return Response.json({ counts: dumpCounts(data), name, ok: true });
  }
  if (action === "load") {
    const row = await getDemoSnapshot({ name });
    if (!row) {
      return Response.json({ error: `没有这个存档：${name}` }, { status: 404 });
    }
    await restoreStudent({ dump: row.data, studentId: SHOW_STUDENT.id });
    return Response.json({ counts: dumpCounts(row.data), name, ok: true });
  }
  return Response.json(
    { error: "action 只能是 save 或 load" },
    { status: 400 }
  );
}
