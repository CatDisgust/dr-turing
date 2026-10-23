"use client";

import {
  Background,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/lib/graph/layout";
import { FULL_O } from "@/lib/learner/config";
import type { Light } from "@/lib/learner/light";
import type { CourseGraph, Edge } from "@/lib/types";

// 课程知识图谱：按课分块；传了 lights 就按学生状态点亮，否则全灰

const LIGHT_STYLE: Record<
  Light,
  { background: string; border: string; color: string }
> = {
  dashed: {
    background: "#fffbeb",
    border: "2px dashed #f59e0b",
    color: "#92400e",
  },
  full: { background: "#f59e0b", border: "1px solid #b45309", color: "#fff" },
  gray: {
    background: "#e5e7eb",
    border: "1px solid #9ca3af",
    color: "#374151",
  },
  half: {
    background: "#fde68a",
    border: "1px solid #d97706",
    color: "#78350f",
  },
};

export const LIGHT_LEGEND: { light: Light; label: string }[] = [
  { label: "没学过", light: "gray" },
  { label: "这次问到了", light: "dashed" },
  { label: "半亮：理解了", light: "half" },
  { label: "全亮：隔天还会", light: "full" },
];

export function lightSwatch(light: Light) {
  const { background, border } = LIGHT_STYLE[light];
  return { background, border, borderRadius: 4, height: 12, width: 18 };
}

const EDGE_STYLE: Record<Edge["type"], Partial<FlowEdge>> = {
  confusable: {
    style: { stroke: "#f59e0b", strokeDasharray: "2 4", strokeWidth: 1.5 },
  },
  part_of: {
    markerEnd: { color: "#94a3b8", type: MarkerType.ArrowClosed },
    style: { stroke: "#94a3b8", strokeDasharray: "6 4", strokeWidth: 1.5 },
  },
  prereq: {
    markerEnd: { color: "#64748b", type: MarkerType.ArrowClosed },
    style: { stroke: "#64748b", strokeWidth: 1.5 },
  },
};

export const EDGE_LEGEND: { type: Edge["type"]; label: string }[] = [
  { label: "先修（箭头指向后学的）", type: "prereq" },
  { label: "属于（箭头指向总概念）", type: "part_of" },
  { label: "易混", type: "confusable" },
];

type LabelNode = FlowNode<{ label: string; o?: number }>;

const LIGHT_RANK: Record<Light, number> = {
  dashed: 1,
  full: 3,
  gray: 0,
  half: 2,
};
// 节点升级后闪多久（毫秒），和 globals.css 里 node-light-up 的时长一致
const FLASH_MS = 1600;

// 节点右上角的小环：自主掌握 O 走到全亮门槛的进度，答对一次就能看到涨（用户 2026-10-21 定）
function ORing({ o }: { o: number }) {
  const r = 7;
  const length = 2 * Math.PI * r;
  const progress = Math.min(o / FULL_O, 1);
  return (
    <svg
      aria-label={`自主掌握 O ${o.toFixed(2)}，全亮要 ${FULL_O}`}
      className="absolute -top-2 -right-2"
      data-testid="o-ring"
      height={20}
      role="img"
      viewBox="0 0 20 20"
      width={20}
    >
      <title>{`自主掌握 O ${o.toFixed(2)} / 全亮 ${FULL_O}`}</title>
      <circle
        cx={10}
        cy={10}
        fill="#fff"
        r={r}
        stroke="#e5e7eb"
        strokeWidth={3}
      />
      <circle
        cx={10}
        cy={10}
        fill="none"
        r={r}
        stroke={progress >= 1 ? "#b45309" : "#f59e0b"}
        strokeDasharray={length}
        strokeDashoffset={length * (1 - progress)}
        strokeLinecap="round"
        strokeWidth={3}
        style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

const HIDDEN_HANDLE = { opacity: 0 };

function LessonNode({ data }: NodeProps<LabelNode>) {
  return <div>{data.label}</div>;
}

function PointNode({ data }: NodeProps<LabelNode>) {
  return (
    <>
      <Handle position={Position.Top} style={HIDDEN_HANDLE} type="target" />
      {data.label}
      {data.o !== undefined && data.o > 0 ? <ORing o={data.o} /> : null}
      <Handle position={Position.Bottom} style={HIDDEN_HANDLE} type="source" />
    </>
  );
}

const NODE_TYPES = { lesson: LessonNode, point: PointNode };

export function GraphPanel({
  graph,
  selectedId,
  onSelect,
  lights,
  progress,
  focusId,
}: {
  graph: CourseGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  lights?: Record<string, Light>;
  // 每个点的自主掌握 O，有值就画进度环
  progress?: Record<string, number>;
  // 变了就把视野移到这个点上
  focusId?: string;
}) {
  // 亮度比上次高的点闪一下（点亮动画，D12）
  const previous = useRef<Record<string, Light> | undefined>(undefined);
  const [flashing, setFlashing] = useState<string[]>([]);
  useEffect(() => {
    const before = previous.current;
    previous.current = lights;
    if (!(before && lights)) {
      return;
    }
    const raised = Object.keys(lights).filter(
      (id) => LIGHT_RANK[lights[id]] > LIGHT_RANK[before[id] ?? "gray"]
    );
    if (raised.length === 0) {
      return;
    }
    setFlashing(raised);
    const timer = setTimeout(() => setFlashing([]), FLASH_MS);
    return () => clearTimeout(timer);
  }, [lights]);

  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  useEffect(() => {
    if (flow && focusId) {
      flow.fitView({ duration: 600, maxZoom: 1.1, nodes: [{ id: focusId }] });
    }
  }, [flow, focusId]);

  const layout = useMemo(() => layoutGraph(graph), [graph]);

  const nodes = useMemo<FlowNode[]>(
    () => [
      ...layout.lessons.map((lesson) => ({
        data: { label: lesson.title },
        draggable: false,
        id: `lesson:${lesson.id}`,
        position: { x: 0, y: lesson.y },
        selectable: false,
        style: {
          background: "rgba(148, 163, 184, 0.08)",
          border: "1px solid rgba(148, 163, 184, 0.4)",
          borderRadius: 12,
          color: "#64748b",
          fontSize: 13,
          fontWeight: 600,
          height: lesson.height,
          padding: 10,
          width: lesson.width,
        },
        type: "lesson",
      })),
      ...graph.points.map((point) => {
        const look = LIGHT_STYLE[lights?.[point.id] ?? "gray"];
        return {
          className: flashing.includes(point.id) ? "node-light-up" : undefined,
          data: { label: point.name, o: progress?.[point.id] },
          id: point.id,
          parentId: `lesson:${point.lessonId}`,
          position: layout.positions[point.id] ?? { x: 0, y: 0 },
          style: {
            alignItems: "center",
            background: look.background,
            border: look.border,
            borderRadius: 8,
            boxShadow:
              point.id === selectedId
                ? "0 0 0 3px rgba(51, 65, 85, 0.45)"
                : "none",
            color: look.color,
            display: "flex",
            fontSize: 12,
            height: NODE_HEIGHT,
            justifyContent: "center",
            lineHeight: 1.2,
            padding: 6,
            textAlign: "center" as const,
            transition: "background 0.6s, border 0.6s, color 0.6s",
            width: NODE_WIDTH,
          },
          type: "point",
        };
      }),
    ],
    [graph, layout, selectedId, lights, progress, flashing]
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      graph.edges.map((edge) => {
        const touched =
          selectedId !== null &&
          (edge.from === selectedId || edge.to === selectedId);
        const base = EDGE_STYLE[edge.type];
        return {
          ...base,
          id: `${edge.type}:${edge.from}:${edge.to}`,
          source: edge.from,
          style: {
            ...base.style,
            opacity: selectedId === null || touched ? 1 : 0.25,
            strokeWidth: touched ? 2.5 : 1.5,
          },
          target: edge.to,
        };
      }),
    [graph, selectedId]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: FlowNode) =>
      onSelect(node.id.startsWith("lesson:") ? null : node.id),
    [onSelect]
  );
  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <ReactFlow
      edges={edges}
      fitView
      minZoom={0.1}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={NODE_TYPES}
      onInit={setFlow}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
