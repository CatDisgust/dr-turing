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
import { useCallback, useEffect, useMemo, useState } from "react";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/lib/graph/layout";
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

type LabelNode = FlowNode<{ label: string }>;

const HIDDEN_HANDLE = { opacity: 0 };

function LessonNode({ data }: NodeProps<LabelNode>) {
  return <div>{data.label}</div>;
}

function PointNode({ data }: NodeProps<LabelNode>) {
  return (
    <>
      <Handle position={Position.Top} style={HIDDEN_HANDLE} type="target" />
      {data.label}
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
  focusId,
}: {
  graph: CourseGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  lights?: Record<string, Light>;
  // 变了就把视野移到这个点上
  focusId?: string;
}) {
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
          data: { label: point.name },
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
            transition: "background 0.4s, border 0.4s",
            width: NODE_WIDTH,
          },
          type: "point",
        };
      }),
    ],
    [graph, layout, selectedId, lights]
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
