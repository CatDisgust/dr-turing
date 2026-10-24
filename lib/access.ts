// 试用账号（2026-10-24 用户选邀请码登录）。没设 ADMIN_CODE 时一切照旧（本地开发、演示），
// 设了以后：没码的人只能进登录页；管理员码能用演示学生和管理页；邀请码只能当自己。
// 这里只放不碰数据库的规则，proxy 和服务端共用

export const ACCESS_COOKIE = "dr-code";

// 只有管理员能进：管理页、生成图谱、演示对比和重置、分类评测、课程图谱页
export const ADMIN_PATHS = [
  "/admin",
  "/graph",
  "/compare",
  "/eval",
  "/course",
  "/api/admin",
  "/api/demo",
  "/api/eval",
];

export const PUBLIC_PATHS = ["/login", "/api/login"];

export type Gate = "pass" | "login" | "forbidden";

function under(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

// 门口只看有没有码、是不是管理员码；邀请码真不真到服务端查库再判
export function gate(
  path: string,
  code: string | undefined,
  adminCode: string | undefined
): Gate {
  if (!adminCode || under(path, PUBLIC_PATHS)) {
    return "pass";
  }
  if (!code) {
    return "login";
  }
  if (under(path, ADMIN_PATHS) && code !== adminCode) {
    return "forbidden";
  }
  return "pass";
}

// 邀请码：小写字母和数字，好念好输（去掉 0/o、1/l/i 这些容易看错的）
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function normalizeCode(input: string) {
  return input.trim().toLowerCase();
}

export function makeCode(name: string, random: () => number = Math.random) {
  const prefix = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  let tail = "";
  for (let i = 0; i < 6; i += 1) {
    tail += CODE_CHARS.charAt(Math.floor(random() * CODE_CHARS.length));
  }
  return prefix ? `${prefix}-${tail}` : tail;
}
