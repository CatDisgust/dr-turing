export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

// D1 验收用的三个并发问题
export const suggestions = [
  "为什么两个线程同时给同一个计数器加 1，结果会变少？",
  "互斥锁为什么能解决竞态条件？",
  "死锁是怎么产生的？",
];
