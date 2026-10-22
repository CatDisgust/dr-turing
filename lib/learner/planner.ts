import type {
  CourseGraph,
  KnowledgePoint,
  LearnerState,
  TutorPlan,
} from "@/lib/types";
import { HALF_M } from "./config";
import { plannerContext } from "./context";
import { type ActionDecision, nextAction, type TurnSignal } from "./policy";

// 规划器第一步：七条规则定下一步（policy.nextAction）。其余字段这里按规则给一份默认值，
// 正常由 Claude 改填（lib/tutor/plan.ts），Claude 调用失败时就用这份

// 低于这个 M、又没证据，算刚接触，讲得完整一些（假设）
const NEW_TO_IT_M = 0.4;
// 求助依赖到这个数，讲解就多给一些、少逼产出（假设）
const HIGH_H = 0.5;

const ACTION_TYPE: Record<ActionDecision["action"], TutorPlan["action_type"]> =
  {
    diagnose_misconception: "scaffold",
    hint: "hint",
    independent_check: "ask",
    review: "ask",
    teach: "explain",
    variant: "ask",
  };

// 学生说过的偏好优先；没说过就按知识类型
function representationOf(
  point: KnowledgePoint,
  preferences: string[]
): TutorPlan["representation"] {
  const said = preferences.join(" ");
  if (/代码|code/i.test(said)) {
    return "code";
  }
  if (/公式|数学/.test(said)) {
    return "formula";
  }
  if (/图|画/.test(said)) {
    return "diagram";
  }
  if (/类比|比喻|例子/.test(said)) {
    return "analogy";
  }
  if (point.kind === "procedure") {
    return "code";
  }
  return point.kind === "design" ? "diagram" : "analogy";
}

export function planTurn(input: {
  graph: CourseGraph;
  state: LearnerState;
  kpId: string;
  sessionId: string;
  signal?: TurnSignal;
}): TutorPlan {
  const { graph, state, signal } = input;
  const ctx = plannerContext(graph, state, input.kpId, input.sessionId);
  const node = state.nodes[input.kpId];
  const decision = nextAction({
    engagement: state.engagement,
    kpId: input.kpId,
    node: node ?? {
      attempts: [],
      explained: false,
      helpOpportunities: 0,
      helpRequests: 0,
      M: ctx.target.M,
      misconceptions: [],
      O: 0,
      review: null,
      stage: "not_covered",
      stuckSessions: [],
      transferPassed: false,
    },
    prereqs: ctx.prereqs.map((p) => ({ kpId: p.id, node: state.nodes[p.id] })),
    signal,
  });
  // 规则 ④ 可能改去先讲一个薄弱的先修，规划围绕真正要讲的那个点
  const target =
    decision.kpId === input.kpId
      ? ctx
      : plannerContext(graph, state, decision.kpId, input.sessionId);
  const point = graph.points.find((p) => p.id === decision.kpId);
  if (!point) {
    throw new Error(`知识点不存在：${decision.kpId}`);
  }

  // 已经理解了的先修（半亮及以上）就从它们讲起，不再重讲
  const owned = target.prereqs.filter((p) => p.M >= HALF_M);
  const start_from = owned.map((p) => p.id);
  const open = target.target.misconceptions.find(
    (m) => m.status !== "repaired" && m.text
  );
  const check_misconception_first = open?.text;
  const dependent = target.target.H !== null && target.target.H >= HIGH_H;
  const newToIt = !target.target.hasEvidence && target.target.M < NEW_TO_IT_M;

  let disclosure_level: TutorPlan["disclosure_level"] = "question";
  if (
    decision.action === "hint" ||
    decision.action === "diagnose_misconception"
  ) {
    disclosure_level = "hint";
  } else if (decision.action === "teach") {
    const fullTeach =
      signal === "just_tell_me" ||
      dependent ||
      (newToIt && start_from.length === 0);
    disclosure_level = fullTeach ? "full" : "partial";
  }

  let action_type = ACTION_TYPE[decision.action];
  if (action_type === "explain" && point.kind === "procedure" && newToIt) {
    action_type = "worked_example";
  }

  const elicits_production = disclosure_level !== "full";
  const reveals_answer = signal === "just_tell_me";

  const why: string[] = [`规则${"①②③④⑤⑥⑦"[decision.rule - 1]}`];
  why.push(
    `「${point.name}」M ${target.target.M.toFixed(2)}、O ${target.target.O.toFixed(2)}`
  );
  if (decision.kpId !== input.kpId) {
    why.push(`先修「${point.name}」已知薄弱，先讲它`);
  }
  if (start_from.length > 0) {
    why.push(
      `已理解 ${owned.map((p) => `「${p.name}」`).join("")}，从这里讲起`
    );
  }
  if (dependent) {
    why.push("求助依赖偏高，多给一些");
  }
  if (check_misconception_first) {
    why.push(`先排查误解「${check_misconception_first}」`);
  }

  return {
    action_type,
    check_misconception_first,
    disclosure_level,
    elicits_production,
    filled_by: "rules",
    next_action: decision.action,
    prompt: decision.prompt,
    rationale: why.join("；"),
    representation: representationOf(
      point,
      state.profile.statedPreferences.map((p) => p.text)
    ),
    reveals_answer,
    rule: decision.rule,
    start_from,
    target_kc: decision.kpId,
  };
}
