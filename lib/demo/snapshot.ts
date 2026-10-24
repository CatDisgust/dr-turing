// 产品演示学生的存档（录演示视频用）：把这个学生在库里的全部记录整份导出成 JSON，
// 之后可以原样写回，或者整体往前挪一段时间再写回（“模拟第二天”，用户 2026-10-24 定）

export type StudentDump = {
  chats: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  votes: Record<string, unknown>[];
  learnerStates: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  events: Record<string, unknown>[];
  studentModels: Record<string, unknown>[];
  conceptEvents: Record<string, unknown>[];
  personalGraphs: Record<string, unknown>[];
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// 复习调度里的时间是数字（秒），按字段名认
const SECOND_KEYS = new Set([
  "nextReviewAt",
  "lastReviewAt",
  "lastScheduledAt",
]);

// 记录里所有时间一起挪 ms 毫秒（负数 = 往前挪）：ISO 字符串和复习调度的秒数，其他原样
export function shiftDump<T>(value: T, ms: number): T {
  return shift(value, ms, "") as T;
}

function shift(value: unknown, ms: number, key: string): unknown {
  if (typeof value === "string") {
    return ISO.test(value)
      ? new Date(Date.parse(value) + ms).toISOString()
      : value;
  }
  if (typeof value === "number") {
    return SECOND_KEYS.has(key) ? value + ms / 1000 : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => shift(v, ms, ""));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shift(v, ms, k)])
    );
  }
  return value;
}

export function dumpCounts(dump: StudentDump) {
  return Object.fromEntries(
    Object.entries(dump).map(([k, rows]) => [k, rows.length])
  );
}
