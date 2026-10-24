import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { addSpend } from "./db/queries";
import { costMicroUsd, type Usage } from "./pricing";

// 试用额度（2026-10-24）：每次调 Claude 花的钱记到“这次请求是谁发的”账上。
// 调 Claude 的地方很深（归类、批改、会后复核……），不一层层传账号，
// 而是路由里认出是谁以后 chargeTo 一下，这次请求后面的调用都记到他头上
const payer = new AsyncLocalStorage<string>();

export function chargeTo(userId: string) {
  payer.enterWith(userId);
}

export function currentPayer() {
  return payer.getStore();
}

// 每次 Claude 调用拿到 usage 后调一下。没人付（脚本、评测）就不记；记账失败不影响学习
export function recordUsage(
  model: string,
  usage: (Usage & { iterations?: unknown }) | null | undefined
) {
  const userId = payer.getStore();
  if (!(userId && usage)) {
    return;
  }
  const micro = costMicroUsd(
    model,
    usage as Parameters<typeof costMicroUsd>[1]
  );
  addSpend(userId, micro).catch((error) => {
    console.error("[spend] 记账失败", error);
  });
}
