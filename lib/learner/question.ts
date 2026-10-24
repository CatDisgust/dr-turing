import type {
  Attempt,
  KnowledgePoint,
  NodeState,
  PendingQuestion,
} from "@/lib/types";
import { FULL_O, REVIEW_MIN_GAP_HOURS } from "./config";

// 出哪道题、批改结果怎么变成一条证据。纯函数，不调模型

export type PickedQuestion = Pick<
  PendingQuestion,
  "kind" | "question" | "questionId"
>;

const hoursBetween = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 3_600_000;

// 该复习了：上次独立做对已经隔了一阵（至少 REVIEW_MIN_GAP_HOURS），还没全亮
export function reviewDue(node: NodeState | undefined, now: string): boolean {
  return Boolean(
    node?.lastIndependentAt &&
      node.O < FULL_O &&
      hoursBetween(node.lastIndependentAt, now) >= REVIEW_MIN_GAP_HOURS
  );
}

// 题都来自建图时给每个点写的检查题：第一道当检查题，第二道当变式题。
// 上次独立做对已经隔了一阵、还没全亮，就拿第一道当复习题
export function pickQuestion(
  point: Pick<KnowledgePoint, "id" | "checkQuestions">,
  node: NodeState | undefined,
  sessionId: string,
  now: string
): PickedQuestion | null {
  const [first, second] = point.checkQuestions;
  if (!first) {
    return null;
  }
  const check = { question: first, questionId: `${point.id}:q0` };
  if (reviewDue(node, now)) {
    return { ...check, kind: "review" };
  }
  const today = node?.attempts.filter((a) => a.sessionId === sessionId) ?? [];
  const passedCheck = today.some(
    (a) => a.correct === true && !a.hinted && a.type !== "transfer_correct"
  );
  if (!passedCheck) {
    return { ...check, kind: "check" };
  }
  // 变式题这次会话答对过就不再重复出，要过提示也算答过
  const triedVariant = today.some((a) => a.type === "transfer_correct");
  if (second && !node?.transferPassed && !triedVariant) {
    return {
      kind: "variant",
      question: second,
      questionId: `${point.id}:q1`,
    };
  }
  return null;
}

export type Grading = {
  correct: boolean;
  // 答错时提出的错误想法；看不出具体想法就是空字符串
  misconception: string;
  producedStep: boolean;
};

const DEPTH = { hint: 0.5, none: 1, revealed: 0 } as const;

// 批改结果 → 一条暂定证据。构建深度按答之前要过什么：没要 1，要了提示 0.5，要了答案 0
// 判完对错后这条证据算哪一类：隔天复习独立答对、变式题答对、检查题答对，或答错
export function gradedType(
  kind: PendingQuestion["kind"] | undefined,
  hinted: boolean,
  correct: boolean
): Attempt["type"] {
  if (!correct) {
    return "check_wrong";
  }
  if (kind === "review" && !hinted) {
    return "review_correct";
  }
  if (kind === "variant") {
    return "transfer_correct";
  }
  return "check_correct";
}

export function attemptFromGrading(
  pending: PendingQuestion,
  grading: Grading,
  turn: { id: string; turnId: string; at: string; quote: string }
): Attempt {
  const hinted = pending.help !== "none";
  const type = gradedType(pending.kind, hinted, grading.correct);
  return {
    ...turn,
    correct: grading.correct,
    d: DEPTH[pending.help],
    hinted,
    misconception:
      !grading.correct && grading.misconception.trim()
        ? grading.misconception.trim()
        : undefined,
    prediction: pending.prediction,
    producedStep: grading.producedStep,
    provisional: true,
    questionKind: pending.kind,
    sessionId: pending.sessionId,
    source: "fast",
    type,
  };
}
