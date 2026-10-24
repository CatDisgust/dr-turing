import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, gate, normalizeCode } from "./lib/access";

// 试用账号的门口：没码去登录页，邀请码进不了管理员页面。邀请码真假由 auth() 查库
export function proxy(request: NextRequest) {
  const admin = normalizeCode(process.env.ADMIN_CODE ?? "") || undefined;
  const path = request.nextUrl.pathname;
  const verdict = gate(path, request.cookies.get(ACCESS_COOKIE)?.value, admin);
  if (verdict === "pass") {
    return NextResponse.next();
  }
  if (path.startsWith("/api/")) {
    return Response.json(
      { error: verdict === "login" ? "请先输入邀请码" : "只有管理员能用" },
      { status: verdict === "login" ? 401 : 403 }
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = verdict === "login" ? "/login" : "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:png|jpg|svg|ico|webp)$).*)",
  ],
};
