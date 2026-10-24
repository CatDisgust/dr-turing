export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

// 首页示例问题，取自 COMP5348 前三课；只在新对话选了这门课时显示（2026-10-24 选课）
export const SUGGESTIONS_COURSE = "comp5348";
export const suggestions = [
  "两个人同时往一个账户里存钱，为什么最后会少一笔？",
  "乐观并发控制和悲观并发控制有什么区别？",
  "远程方法调用为什么不能当成本地调用来用？",
];

// demo 只有一门课；学生状态和快路径归类都按这门课算
export const COURSE_ID = process.env.NEXT_PUBLIC_COURSE_ID ?? "comp5348";

// 聊天和图谱、课件之间用窗口事件通知，不加全局状态
export const NODE_TOUCHED_EVENT = "dr:node-touched";
export const LEARNER_REFRESH_EVENT = "dr:learner-refresh";
export const GRADED_EVENT = "dr:graded";
