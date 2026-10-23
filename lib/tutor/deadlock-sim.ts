// 死锁小模拟的规则（交互方案 C）：两个事务，T1 先锁 A 再锁 B，T2 先锁 B 再锁 A，
// 学生每次让其中一个走一步。拿不到锁就等；两个都在等就是死锁。纯函数，界面和测试共用

export type Txn = 1 | 2;
export type Lock = "A" | "B";

export const STEPS: Record<Txn, string[]> = {
  1: ["锁 A", "锁 B", "提交，放锁"],
  2: ["锁 B", "锁 A", "提交，放锁"],
};

const NEEDS: Record<Txn, Lock[]> = { 1: ["A", "B"], 2: ["B", "A"] };

export type SimState = {
  // 每个事务下一步是第几步，3 是做完了
  pc: Record<Txn, number>;
  owner: Record<Lock, Txn | null>;
  waiting: Record<Txn, boolean>;
  outcome: "running" | "deadlock" | "finished";
};

export const initialSim = (): SimState => ({
  outcome: "running",
  owner: { A: null, B: null },
  pc: { 1: 0, 2: 0 },
  waiting: { 1: false, 2: false },
});

const other = (t: Txn): Txn => (t === 1 ? 2 : 1);

function tryLock(s: SimState, t: Txn): SimState {
  const lock = NEEDS[t][s.pc[t]];
  const holder = s.owner[lock];
  if (holder !== null && holder !== t) {
    return { ...s, waiting: { ...s.waiting, [t]: true } };
  }
  return {
    ...s,
    owner: { ...s.owner, [lock]: t },
    pc: { ...s.pc, [t]: s.pc[t] + 1 },
    waiting: { ...s.waiting, [t]: false },
  };
}

export function stepSim(s: SimState, t: Txn): SimState {
  if (s.outcome !== "running" || s.pc[t] >= 3) {
    return s;
  }
  let next: SimState;
  if (s.pc[t] < 2) {
    next = tryLock(s, t);
  } else {
    // 提交：放掉手里的锁；对方正等着的锁空出来就让它拿到
    const owner = {
      A: s.owner.A === t ? null : s.owner.A,
      B: s.owner.B === t ? null : s.owner.B,
    };
    next = {
      ...s,
      owner,
      pc: { ...s.pc, [t]: 3 },
      waiting: { ...s.waiting, [t]: false },
    };
    if (next.waiting[other(t)]) {
      next = tryLock(next, other(t));
    }
  }
  if (next.waiting[1] && next.waiting[2]) {
    return { ...next, outcome: "deadlock" };
  }
  if (next.pc[1] === 3 && next.pc[2] === 3) {
    return { ...next, outcome: "finished" };
  }
  return next;
}
