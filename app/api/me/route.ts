import { auth } from "@/lib/session";

// 顶栏用：当前是谁、是不是管理员（管理员才显示切换演示学生）
export async function GET() {
  const session = await auth();
  return Response.json({
    name: session.user.name,
    role: session.role,
  });
}
