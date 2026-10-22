import type {
  Attempt,
  CourseGraph,
  KnowledgeKind,
  LearnerState,
  NodeMisconception,
  NodeState,
} from "@/lib/types";
import { BKT } from "./config";
import { isGraded, masteryFromAttempts } from "./mastery";
import { learningStage, type TurnSignal } from "./policy";
import { initialState, scheduleReview } from "./scheduler";

// 证据进来，状态出去，全是纯函数。
// 一个节点的所有数（M、O、H、误解、迁移、复习、阶段）都从它的证据列表重放出来，
// 所以慢路径撤掉一条暂定证据，只要把它从列表里删掉再重放一遍。

export function emptyNode(): NodeState {
  return {
    attempts: [],
    explained: false,
    helpOpportunities: 0,
    helpRequests: 0,
    M: BKT.prior,
    misconceptions: [],
    O: 0,
    review: null,
    stage: "not_covered",
    stuckSessions: [],
    transferPassed: false,
  };
}

export function emptyLearnerState(
  studentId: string,
  courseId: string
): LearnerState {
  return {
    burden: { lost: 0, tooAbstract: 0 },
    courseId,
    engagement: { giveUps: 0, justTellMe: 0, skippedQuestions: 0 },
    nodes: {},
    profile: { background: [], statedPreferences: [] },
    studentId,
  };
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

// 求助依赖 H = helpRequests / helpOpportunities。每道批改过的题是一次机会；
// 小提示后做对算半次求助，答案被揭示后照做算一次，独立做对不算（H 随之下降）
function helpWeight(attempt: Attempt): number {
  if (!attempt.hinted) {
    return 0;
  }
  return attempt.d === 0.5 ? 0.5 : 1;
}

// 误解：答错并匹配到某个误解，次数加一，两次及以上转为确认；之后独立答对这个点的题，记为已修正。
// 题目和误解不是一一对应的，所以独立答对时没标误解 id 就把这个点上没修正的都算修正（D9a）
function nextMisconceptions(
  list: NodeMisconception[],
  attempt: Attempt
): NodeMisconception[] {
  const id = attempt.misconceptionId;
  if (!isGraded(attempt)) {
    return list;
  }
  if (id === undefined) {
    if (!attempt.correct || attempt.hinted) {
      return list;
    }
    return list.map((m) =>
      m.status === "repaired"
        ? m
        : { ...m, lastQuote: attempt.quote, status: "repaired" }
    );
  }
  const current = list.find((m) => m.id === id);
  if (attempt.correct) {
    if (!current || attempt.hinted) {
      return list;
    }
    return list.map((m) =>
      m.id === id ? { ...m, lastQuote: attempt.quote, status: "repaired" } : m
    );
  }
  const seen = (current?.seen ?? 0) + 1;
  const updated: NodeMisconception = {
    id,
    lastQuote: attempt.quote,
    seen,
    status: seen >= 2 ? "confirmed" : "suspected",
  };
  return current
    ? list.map((m) => (m.id === id ? updated : m))
    : [...list, updated];
}

function reviewEvidence(attempt: Attempt) {
  let assessmentType: "quiz" | "qualitative" | "review" = "quiz";
  if (attempt.type === "review_correct") {
    assessmentType = "review";
  } else if (attempt.type === "self_explained") {
    assessmentType = "qualitative";
  }
  return {
    assessmentType,
    attemptCount: 1,
    hintsUsed: attempt.hinted ? 1 : 0,
    result: attempt.correct ? ("correct" as const) : ("incorrect" as const),
    timestamp: seconds(attempt.at),
  };
}

type Carry = Pick<
  NodeState,
  "explained" | "checkFlag" | "touchedInSession" | "retracted"
>;

const carryOf = (node: NodeState): Carry => ({
  checkFlag: node.checkFlag,
  explained: node.explained,
  retracted: node.retracted,
  touchedInSession: node.touchedInSession,
});

// 从证据重放出整个节点。explained、checkFlag、touchedInSession 不全来自本节点证据，原样带过来
export function deriveNode(
  attempts: Attempt[],
  kind: KnowledgeKind,
  carry: Carry = { explained: false }
): NodeState {
  const node: NodeState = { ...emptyNode(), ...carry, attempts };
  const wrongBySession = new Map<string, number>();

  for (const attempt of attempts) {
    node.touchedInSession = attempt.sessionId;
    node.misconceptions = nextMisconceptions(node.misconceptions, attempt);
    if (!isGraded(attempt)) {
      continue;
    }
    node.helpOpportunities += 1;
    node.helpRequests += helpWeight(attempt);
    // 有了自己的证据就不再是“待检查”
    node.checkFlag = undefined;
    node.review = scheduleReview(
      node.review ?? initialState(kind, seconds(attempt.at)),
      kind,
      reviewEvidence(attempt)
    );
    if (attempt.correct && !attempt.hinted) {
      node.lastIndependentAt = attempt.at;
      if (attempt.type === "transfer_correct") {
        node.transferPassed = true;
      }
    }
    if (!attempt.correct) {
      const wrong = (wrongBySession.get(attempt.sessionId) ?? 0) + 1;
      wrongBySession.set(attempt.sessionId, wrong);
      // 同一次会话里答错两次算卡住；不同会话卡住 ≥ 2 次就是反复卡点
      if (wrong === 2) {
        node.stuckSessions = [...node.stuckSessions, attempt.sessionId];
      }
    }
  }

  const { M, O } = masteryFromAttempts(attempts);
  node.M = M;
  node.O = O;
  node.stage = learningStage(attempts, node.explained);
  return node;
}

function kindOf(graph: CourseGraph, kpId: string): KnowledgeKind {
  const point = graph.points.find((p) => p.id === kpId);
  if (!point) {
    throw new Error(`知识点不存在：${kpId}`);
  }
  return point.kind;
}

// 保守的先修传播：一个点最近两次批改都答错，而它的先修还没有任何证据时，
// 只把先修标成“待检查”，绝不改先修的 M、O
function flagPrereqs(
  nodes: LearnerState["nodes"],
  graph: CourseGraph,
  kpId: string
): LearnerState["nodes"] {
  const graded = nodes[kpId].attempts.filter(isGraded);
  const lastTwo = graded.slice(-2);
  if (lastTwo.length < 2 || lastTwo.some((a) => a.correct)) {
    return nodes;
  }
  const next = { ...nodes };
  for (const edge of graph.edges) {
    if (edge.type !== "prereq" || edge.to !== kpId) {
      continue;
    }
    const prereq = next[edge.from] ?? emptyNode();
    if (!prereq.attempts.some(isGraded)) {
      next[edge.from] = { ...prereq, checkFlag: "prereq_suspect" };
    }
  }
  return next;
}

// 一条证据进来：重放这个节点，再做先修传播；独立做对说明学生又投入了，投入度计数清零（假设）
export function applyEvidence(
  state: LearnerState,
  graph: CourseGraph,
  kpId: string,
  attempt: Attempt
): LearnerState {
  const node = state.nodes[kpId] ?? emptyNode();
  const derived = deriveNode(
    [...node.attempts, attempt],
    kindOf(graph, kpId),
    carryOf(node)
  );
  const reengaged = attempt.correct === true && !attempt.hinted;
  return {
    ...state,
    engagement: reengaged
      ? { giveUps: 0, justTellMe: 0, lastAt: attempt.at, skippedQuestions: 0 }
      : state.engagement,
    nodes: flagPrereqs({ ...state.nodes, [kpId]: derived }, graph, kpId),
  };
}

// 慢路径复核后撤掉一条证据：删掉再重放。先修上的“待检查”标记不撤，它本来就不扣分
export function retractEvidence(
  state: LearnerState,
  graph: CourseGraph,
  kpId: string,
  attemptId: string
): LearnerState {
  const node = state.nodes[kpId];
  if (!node) {
    return state;
  }
  const derived = deriveNode(
    node.attempts.filter((a) => a.id !== attemptId),
    kindOf(graph, kpId),
    carryOf(node)
  );
  return { ...state, nodes: { ...state.nodes, [kpId]: derived } };
}

// 导师讲过这个点：讲解算“接收”，不动 M、O，只影响学习阶段
export function markExplained(
  state: LearnerState,
  graph: CourseGraph,
  kpId: string
): LearnerState {
  const node = state.nodes[kpId] ?? emptyNode();
  const derived = deriveNode(node.attempts, kindOf(graph, kpId), {
    ...carryOf(node),
    explained: true,
  });
  return { ...state, nodes: { ...state.nodes, [kpId]: derived } };
}

// 快路径归类到这个点：本次会话涉及过，节点虚线亮；不动任何数
export function touchNode(
  state: LearnerState,
  kpId: string,
  sessionId: string
): LearnerState {
  const node = state.nodes[kpId] ?? emptyNode();
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [kpId]: { ...node, touchedInSession: sessionId },
    },
  };
}

// 投入度 W：放弃、“直接告诉我”、跳题各记一笔；“给提示”只是请求，不算 W
export function applySignal(
  state: LearnerState,
  signal: TurnSignal,
  at: string
): LearnerState {
  const { engagement } = state;
  if (signal === "give_up") {
    return {
      ...state,
      engagement: {
        ...engagement,
        giveUps: engagement.giveUps + 1,
        lastAt: at,
      },
    };
  }
  if (signal === "just_tell_me") {
    return {
      ...state,
      engagement: {
        ...engagement,
        justTellMe: engagement.justTellMe + 1,
        lastAt: at,
      },
    };
  }
  if (signal === "skip") {
    return {
      ...state,
      engagement: {
        ...engagement,
        lastAt: at,
        skippedQuestions: engagement.skippedQuestions + 1,
      },
    };
  }
  return state;
}
