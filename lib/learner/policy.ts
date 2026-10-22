import type {
  Attempt,
  KnowledgeKind,
  LearnerState,
  LearningStage,
  NodeState,
} from "@/lib/types";
import {
  ENGAGEMENT_LOW,
  FULL_O,
  HALF_M,
  QUALITATIVE_KINDS,
  QUANTITATIVE_GATE,
} from "./config";
import { isGraded } from "./mastery";

// 翻译部分出自 DeepTutor（github.com/HKUDS/DeepTutor，Apache-2.0）deeptutor/learning/policy.py，commit a31d826。
// 决策，全是纯函数，不调模型。
// 上半部分逐行翻译 DeepTutor learning/policy.py：门槛、learningStage、挑哪个点（pickObjective）。
// 下半部分是实现规划里的七条规则（nextAction）：选定一个点之后，这一轮做什么。

// ---- DeepTutor 翻译 ----

const QUALITATIVE_PASS_DISPLAY = 1;

export function gateKind(kind: KnowledgeKind): "qualitative" | "quantitative" {
  return QUALITATIVE_KINDS.includes(kind) ? "qualitative" : "quantitative";
}

export function gateThreshold(kind: KnowledgeKind): number {
  if (QUALITATIVE_KINDS.includes(kind)) {
    return QUALITATIVE_PASS_DISPLAY;
  }
  return QUANTITATIVE_GATE[kind] ?? 0.9;
}

// DeepTutor learning_stage。对应关系：批改过的题 = quiz_attempts（independent = 没要提示），
// 学生自己讲对 self_explained = qualitative evidence
export function learningStage(
  attempts: Attempt[],
  explained: boolean
): LearningStage {
  const quizzes = attempts.filter(
    (a) => isGraded(a) && a.type !== "self_explained"
  );
  const evidence = attempts.filter(
    (a) => a.type === "self_explained" && isGraded(a)
  );
  if (
    quizzes.some((a) => !a.hinted && a.correct) ||
    evidence.some((a) => a.correct && !a.hinted)
  ) {
    return "independent";
  }
  if (quizzes.some((a) => a.hinted) || evidence.some((a) => a.hinted)) {
    return "correct_with_help";
  }
  if (quizzes.length > 0 || evidence.length > 0) {
    return "practiced_unproven";
  }
  return explained ? "explained" : "not_covered";
}

export type ReviewTask = {
  kpId: string;
  dueAt: number; // 秒
  forgettingRisk: number;
  priority: number;
};

// DeepTutor due_reviews + scheduler.review_sort_key：先忘得快的，再过期久的，再优先级
export function dueReviews(reviews: ReviewTask[], now: number): ReviewTask[] {
  return reviews
    .filter((task) => task.dueAt <= now)
    .sort(
      (a, b) =>
        b.forgettingRisk - a.forgettingRisk ||
        Math.max(0, now - b.dueAt) - Math.max(0, now - a.dueAt) ||
        a.priority - b.priority
    );
}

export type ObjectiveAction =
  | "answer_pending"
  | "review"
  | "probe"
  | "teach"
  | "practice"
  | "assess"
  | "complete";

export type ObjectiveInput = {
  // 课按 order 排，课内知识点按给定顺序
  lessons: { id: string; order: number; pointIds: string[] }[];
  kinds: Record<string, KnowledgeKind>;
  mastered: Set<string>; // Dr.Turing 里是 O ≥ FULL_O
  seen: Set<string>; // 有过批改的证据
  pendingKpId?: string;
  reviews: ReviewTask[];
  deferred: Set<string>; // 学生说“先跳过”的点
  teachFirst: boolean;
  now: number;
};

// DeepTutor next_objective：①有题没批先批 ②有到期复习先复习 ③按课序找第一个没掌握的点 ④全掌握了
export function pickObjective(input: ObjectiveInput): {
  action: ObjectiveAction;
  kpId?: string;
} {
  if (input.pendingKpId !== undefined) {
    return { action: "answer_pending", kpId: input.pendingKpId };
  }

  const due = dueReviews(input.reviews, input.now).filter(
    (task) => !input.deferred.has(task.kpId)
  );
  if (due.length > 0 && input.kinds[due[0].kpId] !== undefined) {
    return { action: "review", kpId: due[0].kpId };
  }

  let deferredFallback: { action: ObjectiveAction; kpId: string } | undefined;
  const lessons = [...input.lessons].sort((a, b) => a.order - b.order);
  for (const lesson of lessons) {
    for (const kpId of lesson.pointIds) {
      if (input.mastered.has(kpId)) {
        continue;
      }
      let action: ObjectiveAction;
      if (!input.seen.has(kpId)) {
        action = input.teachFirst ? "teach" : "probe";
      } else if (gateKind(input.kinds[kpId]) === "qualitative") {
        action = "assess";
      } else {
        action = "practice";
      }
      if (input.deferred.has(kpId)) {
        deferredFallback ??= { action, kpId };
        continue;
      }
      return { action, kpId };
    }
  }
  return deferredFallback ?? { action: "complete" };
}

// ---- 七条规则（实现规划“会话内的导师逻辑”）----

export type TurnSignal = "hint" | "give_up" | "just_tell_me" | "skip";

export type NextAction =
  | "diagnose_misconception"
  | "teach"
  | "hint"
  | "independent_check"
  | "variant"
  | "review";

export type TutorPrompt =
  | "aha"
  | "counterexample"
  | "min_hint"
  | "question"
  | "review";

export type ActionDecision = {
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  action: NextAction;
  prompt: TutorPrompt;
  kpId: string; // 规则 ④ 可能改成先讲一个已知薄弱的先修
};

export function engagementLow(engagement: LearnerState["engagement"]): boolean {
  return (
    engagement.giveUps + engagement.justTellMe + engagement.skippedQuestions >=
    ENGAGEMENT_LOW
  );
}

// 有过批改证据、而且 M 还没到半亮的先修，才算“已知薄弱”；没证据的先修交给诊断入口去问
function knownWeak(node: NodeState | undefined): boolean {
  if (!node) {
    return false;
  }
  return node.attempts.some(isGraded) && node.M < HALF_M;
}

// 从上往下对七条规则，命中第一条就定下动作
export function nextAction(input: {
  kpId: string;
  node: NodeState;
  engagement: LearnerState["engagement"];
  signal?: TurnSignal;
  prereqs: { kpId: string; node?: NodeState }[];
}): ActionDecision {
  const { kpId, node, signal } = input;
  if (signal === "give_up" || engagementLow(input.engagement)) {
    // ① 先安抚，换更小的一步
    return { action: "hint", kpId, prompt: "min_hint", rule: 1 };
  }
  if (signal === "hint") {
    return { action: "hint", kpId, prompt: "min_hint", rule: 2 };
  }
  if (signal === "just_tell_me") {
    // ② 学生要答案：给讲解，答案全揭示
    return { action: "teach", kpId, prompt: "aha", rule: 2 };
  }
  // 只认从学生错答里提出来、有原文的错误想法；旧数据里按图谱误解编号记的没有原文，不再触发
  if (node.misconceptions.some((m) => m.status !== "repaired" && m.text)) {
    return {
      action: "diagnose_misconception",
      kpId,
      prompt: "counterexample",
      rule: 3,
    };
  }
  if (node.M < HALF_M) {
    const weak = input.prereqs.find((p) => knownWeak(p.node));
    return {
      action: "teach",
      kpId: weak?.kpId ?? kpId,
      prompt: "aha",
      rule: 4,
    };
  }
  if (node.O < FULL_O) {
    return { action: "independent_check", kpId, prompt: "question", rule: 5 };
  }
  if (!node.transferPassed) {
    return { action: "variant", kpId, prompt: "question", rule: 6 };
  }
  return { action: "review", kpId, prompt: "review", rule: 7 };
}
