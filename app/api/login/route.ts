import { cookies } from "next/headers";
import { ACCESS_COOKIE, normalizeCode } from "@/lib/access";
import { getInviteByCode, touchInvite } from "@/lib/db/queries";
import { adminCode } from "@/lib/session";

const YEAR = 60 * 60 * 24 * 365;

// 输邀请码登录：对了就记一年，以后不用再输
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = normalizeCode(body.code ?? "");
  if (!code) {
    return Response.json({ error: "请输入邀请码" }, { status: 400 });
  }
  const admin = adminCode();
  let role: "admin" | "trial";
  if (admin && code === admin) {
    role = "admin";
  } else {
    const invite = await getInviteByCode(code);
    if (!invite) {
      return Response.json({ error: "这个邀请码不对" }, { status: 401 });
    }
    if (invite.disabled) {
      return Response.json({ error: "这个邀请码已停用" }, { status: 403 });
    }
    await touchInvite(code);
    role = "trial";
  }
  const store = await cookies();
  store.set(ACCESS_COOKIE, code, {
    httpOnly: true,
    maxAge: YEAR,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return Response.json({ role });
}

// 退出：清掉记住的邀请码
export async function DELETE() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  return Response.json({ ok: true });
}
