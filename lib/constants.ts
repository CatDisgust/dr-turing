export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

// 首页示例问题，取自 COMP5348 前三课
export const suggestions = [
  "两个人同时往一个账户里存钱，为什么最后会少一笔？",
  "乐观并发控制和悲观并发控制有什么区别？",
  "远程方法调用为什么不能当成本地调用来用？",
];
