import type {
  Attempt,
  CourseGraph,
  LearnerState,
  ReviewVerdict,
  SessionReport,
} from "@/lib/types";
import { BKT } from "./config";
import { isGraded, masteryFromAttempts } from "./mastery";
import { learnRateOf, retractEvidence, reviseEvidence } from "./update";

// 会后复核落到状态上：复核确认的暂定证据转正，推翻的撤掉并留下原因，判反了的改判后重放。
// 复核没提到的暂定证据按确认处理（检查题有服务端答案，推翻的本来就少）

export function applyReview(
  state: LearnerState,
  graph: CourseGraph,
  sessionId: string,
  verdicts: ReviewVerdict[],
  now: string
): {
  state: LearnerState;
  confirmed: number;
  retracted: SessionReport["retracted"];
  revised: NonNullable<SessionReport["revised"]>;
  // 撤销、改判了哪些证据：记进 Event 表，学生模型重算时用（学生建模方案 F）
  changes: {
    attemptId: string;
    turnId: string;
    kpId: string;
    type: "review_retract" | "review_flip";
  }[];
} {
  const byId = new Map(verdicts.map((v) => [v.attemptId, v]));
  let next = state;
  let confirmed = 0;
  const retracted: SessionReport["retracted"] = [];
  const revised: NonNullable<SessionReport["revised"]> = [];
  const changes: {
    attemptId: string;
    turnId: string;
    kpId: string;
    type: "review_retract" | "review_flip";
  }[] = [];
  const nameOf = (kpId: string) =>
    graph.points.find((p) => p.id === kpId)?.name ?? kpId;

  for (const [kpId, node] of Object.entries(state.nodes)) {
    for (const attempt of node.attempts) {
      if (!attempt.provisional || attempt.sessionId !== sessionId) {
        continue;
      }
      const verdict = byId.get(attempt.id);
      if (verdict?.verdict === "retract") {
        next = retractEvidence(next, graph, kpId, attempt.id);
        const after = next.nodes[kpId];
        next = {
          ...next,
          nodes: {
            ...next.nodes,
            [kpId]: {
              ...after,
              retracted: [
                ...(after.retracted ?? []),
                { at: now, attempt, reason: verdict.reason },
              ],
            },
          },
        };
        changes.push({
          attemptId: attempt.id,
          kpId,
          turnId: attempt.turnId,
          type: "review_retract",
        });
        retracted.push({
          kpId,
          name: nameOf(kpId),
          quote: attempt.quote,
          reason: verdict.reason,
        });
      } else if (verdict?.verdict === "flip" && attempt.correct !== undefined) {
        next = reviseEvidence(next, graph, kpId, attempt.id);
        changes.push({
          attemptId: attempt.id,
          kpId,
          turnId: attempt.turnId,
          type: "review_flip",
        });
        revised.push({
          correct: !attempt.correct,
          kpId,
          name: nameOf(kpId),
          quote: attempt.quote,
          reason: verdict.reason,
        });
      } else {
        confirmed += 1;
      }
    }
  }

  // 剩下的这次会话的暂定证据全部转正；转正不改任何数，只去掉“暂定”
  const nodes = Object.fromEntries(
    Object.entries(next.nodes).map(([kpId, node]) => [
      kpId,
      {
        ...node,
        attempts: node.attempts.map((a) =>
          a.provisional && a.sessionId === sessionId
            ? { ...a, provisional: false }
            : a
        ),
      },
    ])
  );
  return { changes, confirmed, retracted, revised, state: { ...next, nodes } };
}

const ratio = (k: number, n: number) => (n === 0 ? null : k / n);
const round = (x: number) => Math.round(x * 100) / 100;

// 会话报告：只看这次会话的证据，全是代码算的。O 增量 = 带上这次的证据 vs 不带
export function sessionReport(input: {
  state: LearnerState;
  graph: CourseGraph;
  sessionId: string;
  leaks: number;
  confirmed: number;
  retracted: SessionReport["retracted"];
  now: string;
}): SessionReport {
  const { state, graph, sessionId } = input;
  const graded: Attempt[] = [];
  const oGain: SessionReport["oGain"] = [];

  for (const [kpId, node] of Object.entries(state.nodes)) {
    const mine = node.attempts.filter(
      (a) => a.sessionId === sessionId && isGraded(a)
    );
    if (mine.length === 0) {
      continue;
    }
    graded.push(...mine);
    const before = masteryFromAttempts(
      node.attempts.filter((a) => a.sessionId !== sessionId),
      BKT.prior,
      learnRateOf(state)
    ).O;
    oGain.push({
      after: round(node.O),
      before: round(before),
      kpId,
      name: graph.points.find((p) => p.id === kpId)?.name ?? kpId,
    });
  }

  const own = graded.filter((a) => a.correct && !a.hinted).length;
  return {
    confirmed: input.confirmed,
    leaks: input.leaks,
    oGain,
    ownSteps: own,
    retracted: input.retracted,
    revealRate: ratio(graded.filter((a) => a.d === 0).length, graded.length),
    reviewedAt: input.now,
    selfProducedRate: ratio(
      graded.filter((a) => a.producedStep).length,
      graded.length
    ),
    sessionId,
    steps: graded.length,
  };
}
