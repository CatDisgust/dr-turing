import type { CourseGraph, LearnerState, NodeState } from "@/lib/types";
import { engagementOf, signals } from "./events";
import { type Light, nodeLight } from "./light";
import { isGraded } from "./mastery";

// 给规划器的切片：目标节点 + 两跳以内的先修 + 易混点。规划器只读这些，
// 不读整张图，数据都在内存里，取一次是毫秒级

const round = (x: number) => Math.round(x * 100) / 100;

export type NodeSummary = {
  id: string;
  name: string;
  M: number;
  O: number;
  H: number | null; // 还没有批改过的题时为 null
  light: Light;
  stage: NodeState["stage"];
  hasEvidence: boolean;
  checkFlag?: NodeState["checkFlag"];
};

function summarize(
  graph: CourseGraph,
  state: LearnerState,
  kpId: string,
  sessionId?: string
): NodeSummary {
  const point = graph.points.find((p) => p.id === kpId);
  const node = state.nodes[kpId];
  return {
    checkFlag: node?.checkFlag,
    H:
      node && node.helpOpportunities > 0
        ? round(node.helpRequests / node.helpOpportunities)
        : null,
    hasEvidence: node?.attempts.some(isGraded) ?? false,
    id: kpId,
    light: nodeLight(node, sessionId).light,
    M: round(node?.M ?? 0),
    name: point?.name ?? kpId,
    O: round(node?.O ?? 0),
    stage: node?.stage ?? "not_covered",
  };
}

export function plannerContext(
  graph: CourseGraph,
  state: LearnerState,
  kpId: string,
  sessionId?: string
) {
  const point = graph.points.find((p) => p.id === kpId);
  if (!point) {
    throw new Error(`知识点不存在：${kpId}`);
  }
  const prereqsOf = (id: string) =>
    graph.edges
      .filter((e) => e.type === "prereq" && e.to === id)
      .map((e) => e.from);

  const oneHop = prereqsOf(kpId);
  const twoHop = [
    ...new Set(oneHop.flatMap(prereqsOf).filter((id) => id !== kpId)),
  ].filter((id) => !oneHop.includes(id));
  const confusable = graph.edges
    .filter(
      (e) => e.type === "confusable" && (e.from === kpId || e.to === kpId)
    )
    .map((e) => (e.from === kpId ? e.to : e.from));
  const node = state.nodes[kpId];

  return {
    confusable: confusable.map((id) => summarize(graph, state, id, sessionId)),
    prereqs: [
      ...oneHop.map((id) => ({
        hops: 1 as const,
        ...summarize(graph, state, id, sessionId),
      })),
      ...twoHop.map((id) => ({
        hops: 2 as const,
        ...summarize(graph, state, id, sessionId),
      })),
    ],
    // 投入度 W、负担 B（按轮次衰减）
    signals: (({ B, W }) => ({ B: round(B), W: round(W) }))(
      signals(engagementOf(state))
    ),
    target: {
      ...summarize(graph, state, kpId, sessionId),
      checkQuestions: point.checkQuestions,
      definition: point.definition,
      kind: point.kind,
      misconceptions: node?.misconceptions ?? [],
      transferPassed: node?.transferPassed ?? false,
    },
  };
}
