import { describe, expect, it } from "vitest";
import { initialSim, stepSim, type Txn } from "../deadlock-sim";

const run = (order: Txn[]) => order.reduce(stepSim, initialSim());

describe("死锁小模拟", () => {
  it("交替各拿一把锁再去要对方的：死锁", () => {
    const s = run([1, 2, 1, 2]);
    expect(s.outcome).toBe("deadlock");
    expect(s.owner).toEqual({ A: 1, B: 2 });
  });

  it("T1 一口气做完再让 T2 走：都做完", () => {
    expect(run([1, 1, 1, 2, 2, 2]).outcome).toBe("finished");
  });

  it("T2 在等的锁被放掉时自动拿到", () => {
    const s = run([1, 1, 2, 1]);
    expect(s.waiting[2]).toBe(false);
    expect(s.owner.B).toBe(2);
    expect(run([1, 1, 2, 1, 2, 2]).outcome).toBe("finished");
  });

  it("卡死之后再点没有反应", () => {
    const s = run([1, 2, 1, 2]);
    expect(stepSim(s, 1)).toBe(s);
  });
});
