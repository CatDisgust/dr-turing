import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, normalizeCode } from "./access";
import { getInviteByCode } from "./db/queries";
import type { Invite } from "./db/schema";
import { STUDENT_COOKIE, STUDENTS, studentByKey } from "./students";

// 没设 ADMIN_CODE：和以前一样没有登录，顶栏切换学生（D11），默认演示学生。
// 设了以后（2026-10-24 试用账号）：管理员码照旧能切演示学生；邀请码只能当自己
export const DEMO_STUDENT_ID = STUDENTS[0].id;

export type User = {
  id: string;
  name: string;
};

export type Role = "open" | "admin" | "trial";

export type Session = {
  user: User;
  role: Role;
  invite?: Invite;
};

export function adminCode() {
  const code = normalizeCode(process.env.ADMIN_CODE ?? "");
  return code || undefined;
}

export async function auth(): Promise<Session> {
  const store = await cookies();
  const admin = adminCode();
  const code = store.get(ACCESS_COOKIE)?.value;
  if (!admin || code === admin) {
    const student = studentByKey(store.get(STUDENT_COOKIE)?.value);
    return {
      role: admin ? "admin" : "open",
      user: { id: student.id, name: student.name },
    };
  }
  const invite = code ? await getInviteByCode(code) : null;
  if (!invite || invite.disabled) {
    redirect("/login");
  }
  return {
    invite,
    role: "trial",
    user: { id: invite.userId, name: invite.name },
  };
}
