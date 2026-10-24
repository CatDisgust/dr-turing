import { makeCode } from "@/lib/access";
import {
  createInvite,
  getInviteByCode,
  getLearnerStatesByStudent,
  listFeedback,
  listInvitesWithUsage,
  updateInvite,
} from "@/lib/db/queries";
import { learnStats } from "@/lib/learner/trial-stats";
import { auth } from "@/lib/session";

// 管理页：开邀请码、停用 / 恢复、改每日上限。proxy 已挡住非管理员，这里再查一次
async function isAdmin() {
  return (await auth()).role !== "trial";
}

export async function GET() {
  if (!(await isAdmin())) {
    return Response.json({ error: "只有管理员能用" }, { status: 403 });
  }
  const [rows, feedback] = await Promise.all([
    listInvitesWithUsage(),
    listFeedback(),
  ]);
  // 学得怎么样：答题、点亮、该复习（试用效果，2026-10-24）
  const now = new Date().toISOString();
  const invites = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      learn: learnStats(
        await getLearnerStatesByStudent({ studentId: row.userId }),
        now
      ),
    }))
  );
  return Response.json({ feedback, invites });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "只有管理员能用" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    dailyLimit?: number;
  };
  const name = (body.name ?? "").trim().slice(0, 40);
  if (!name) {
    return Response.json({ error: "给这个同学起个名字" }, { status: 400 });
  }
  const code = await freshCode(name);
  if (!code) {
    return Response.json({ error: "没开成，再点一次" }, { status: 500 });
  }
  const invite = await createInvite({
    code,
    dailyLimit: limitOf(body.dailyLimit),
    name,
  });
  return Response.json({ invite });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "只有管理员能用" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    disabled?: boolean;
    dailyLimit?: number;
    rotate?: boolean;
  };
  const row = body.code ? await getInviteByCode(body.code) : null;
  if (!(body.code && row)) {
    return Response.json({ error: "没有这个邀请码" }, { status: 404 });
  }
  // 换码：登录链接被转出去了，旧码作废、换一个新的，账号和学习记录不动
  if (body.rotate) {
    const code = await freshCode(row.name);
    if (!code) {
      return Response.json({ error: "没换成，再点一次" }, { status: 500 });
    }
    await updateInvite(body.code, { code });
    return Response.json({ code, ok: true });
  }
  await updateInvite(body.code, {
    ...(typeof body.disabled === "boolean" ? { disabled: body.disabled } : {}),
    ...(body.dailyLimit === undefined
      ? {}
      : { dailyLimit: limitOf(body.dailyLimit) }),
  });
  return Response.json({ ok: true });
}

// 随机部分 6 位，撞上已有的码就再换一个
async function freshCode(name: string) {
  const tries = Array.from({ length: 5 }, () => makeCode(name));
  const taken = await Promise.all(tries.map((c) => getInviteByCode(c)));
  return tries.find((_, i) => !taken[i]);
}

function limitOf(value: unknown) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 100;
}
