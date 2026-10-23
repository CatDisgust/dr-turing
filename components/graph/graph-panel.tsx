"use client";

import {
  BaseEdge,
  Controls,
  type EdgeProps,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./star-map.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "@/lib/graph/layout";
import { FULL_O } from "@/lib/learner/config";
import type { Light } from "@/lib/learner/light";
import type { CourseGraph, Edge } from "@/lib/types";

// 课程知识图谱，星图样式（用户 2026-10-23 选定“天文馆”）：纯黑星空，学会的点是发光的星，
// 全亮的星带十字光芒；背后一张网格，鼠标划过时网格被推弯，星只轻轻晃、离鼠标近了就停住，方便点。
// 按课分块；传了 lights 就按学生状态点亮，否则全暗

const SKY = "#050506";
const GRID = "#141418";
const GRID_MAJOR = "#212127";
const GLOW = "#fff1d6";
const CORE = "#ffffff";
const HALF_CORE = "#ffe6b3";
const DIM = "#5d5c61";
const TEXT = "#f3efe6";
const TEXT_DIM = "#77756f";
const LINE = "#26262b";
const LIT_LINE = "rgba(255, 238, 205, 0.55)";
const CHAIN = "#8d8a83";
const CONFUSABLE = "#d9a066";

// 星心在节点里的位置：左边 32px 宽的一格的正中
const STAR_X = 16;
const STAR_Y = NODE_HEIGHT / 2;

// 鼠标力场：位移 = 强度 × 高斯衰减；网格吃满，星最多挪 STAR_MAX 像素，离鼠标 STAR_STILL 以内完全不动
const FIELD_RADIUS = 130;
const FIELD_PUSH = 44;
const STAR_MAX = 10;
const STAR_STILL = 30;
const GRID_STEP = 40;
const GRID_SAMPLE = 20;

export const LIGHT_LEGEND: { light: Light; label: string }[] = [
  { label: "没学过", light: "gray" },
  { label: "这次问到了", light: "dashed" },
  { label: "半亮：理解了", light: "half" },
  { label: "全亮：隔天还会", light: "full" },
];

// 图例里的小星（深色底上用）
export function lightSwatch(light: Light): React.CSSProperties {
  const dot = (size: number) => ({
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
    height: size,
    margin: (14 - size) / 2,
    width: size,
  });
  if (light === "full") {
    return { ...dot(9), background: CORE, boxShadow: `0 0 6px 2px ${GLOW}` };
  }
  if (light === "half") {
    return { ...dot(7), background: HALF_CORE, boxShadow: `0 0 4px ${GLOW}` };
  }
  if (light === "dashed") {
    return { ...dot(12), border: `1.2px dashed ${GLOW}` };
  }
  return { ...dot(4), background: DIM };
}

export const EDGE_LEGEND: { type: Edge["type"]; label: string }[] = [
  { label: "先修（两颗都亮时变亮）", type: "prereq" },
  { label: "属于（短虚线）", type: "part_of" },
  { label: "易混（选中节点时显示）", type: "confusable" },
];

type PointData = {
  label: string;
  light: Light;
  o?: number;
  selected: boolean;
  flash: boolean;
};
type PointNodeType = FlowNode<PointData>;
type LessonNodeType = FlowNode<{ label: string; lit?: string }>;
type StarEdgeType = FlowEdge<{ label?: string }>;

const LIGHT_RANK: Record<Light, number> = {
  dashed: 1,
  full: 3,
  gray: 0,
  half: 2,
};
// 节点升级后闪多久（毫秒），和 star-map.css 里 star-ripple 的时长一致
const FLASH_MS = 1600;

// 一颗星，画在 (0,0)：亮度决定大小和光晕；外圈细弧是 O 走到全亮门槛的进度（用户 2026-10-21 定）
function Star({ light, o, selected, flash }: Omit<PointData, "label">) {
  const progress = o === undefined ? 0 : Math.min(o / FULL_O, 1);
  const arc = light === "half" ? 8.5 : 12;
  const length = 2 * Math.PI * arc;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute overflow-visible"
      height={1}
      style={{ left: STAR_X, top: STAR_Y }}
      width={1}
    >
      <circle
        className="star-hover"
        fill="none"
        r={15}
        stroke="#cfcac0"
        strokeWidth={1}
        style={selected ? { opacity: 1 } : undefined}
      />
      {light === "full" ? (
        <>
          <circle fill="url(#star-halo)" r={30} />
          <rect
            fill="url(#star-spike)"
            height={1.6}
            width={48}
            x={-24}
            y={-0.8}
          />
          <rect
            fill="url(#star-spike)"
            height={1.6}
            transform="rotate(90)"
            width={48}
            x={-24}
            y={-0.8}
          />
          <circle fill={CORE} r={5.5} />
        </>
      ) : null}
      {light === "half" ? (
        <>
          <circle fill="url(#star-halo)" opacity={0.75} r={16} />
          <circle fill={HALF_CORE} r={3.8} />
        </>
      ) : null}
      {light === "dashed" ? (
        <>
          <circle
            className="star-breathe"
            fill="url(#star-halo)"
            opacity={0.35}
            r={14}
          />
          <circle
            fill="none"
            r={9}
            stroke={GLOW}
            strokeDasharray="2.5 3"
            strokeWidth={1.2}
          />
          <circle fill={DIM} r={2.6} />
        </>
      ) : null}
      {light === "gray" ? <circle fill={DIM} r={1.9} /> : null}
      {progress > 0 && light !== "full" ? (
        <circle
          data-testid="o-ring"
          fill="none"
          opacity={0.9}
          r={arc}
          stroke={HALF_CORE}
          strokeDasharray={`${length * progress} ${length}`}
          strokeWidth={1.1}
          style={{ transition: "stroke-dasharray 0.8s ease-out" }}
          transform="rotate(-90)"
        >
          <title>{`自主掌握 O ${(o ?? 0).toFixed(2)} / 全亮 ${FULL_O}`}</title>
        </circle>
      ) : null}
      {flash ? (
        <circle
          className="star-ripple"
          fill="none"
          r={6}
          stroke={GLOW}
          strokeWidth={2}
        />
      ) : null}
    </svg>
  );
}

// 光晕和光芒的渐变，整页共用
function StarDefs() {
  return (
    <svg aria-hidden="true" className="absolute" height={0} width={0}>
      <defs>
        <radialGradient id="star-halo">
          <stop offset="0%" stopColor={GLOW} stopOpacity={0.9} />
          <stop offset="30%" stopColor={GLOW} stopOpacity={0.36} />
          <stop offset="100%" stopColor={GLOW} stopOpacity={0} />
        </radialGradient>
        <linearGradient id="star-spike">
          <stop offset="0%" stopColor={GLOW} stopOpacity={0} />
          <stop offset="50%" stopColor={CORE} stopOpacity={0.9} />
          <stop offset="100%" stopColor={GLOW} stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// 连线从星心出发：把隐藏的连接点放在星心上
const STAR_HANDLE: React.CSSProperties = {
  border: 0,
  height: 1,
  left: STAR_X,
  minHeight: 0,
  minWidth: 0,
  opacity: 0,
  top: STAR_Y,
  transform: "translate(-50%, -50%)",
  width: 1,
};

function LessonNode({ data }: NodeProps<LessonNodeType>) {
  return (
    <div>
      {data.label}
      {data.lit ? (
        <div style={{ color: "#7d7a74", fontSize: 12, fontWeight: 400 }}>
          {data.lit}
        </div>
      ) : null}
    </div>
  );
}

function PointNode({ data }: NodeProps<PointNodeType>) {
  const bright = data.light !== "gray";
  return (
    <>
      <Handle position={Position.Top} style={STAR_HANDLE} type="target" />
      {/* star-body 整体跟着鼠标力场挪，位移由 useStarField 直接写 transform */}
      <div className="star-body absolute inset-0 flex items-center">
        <Star
          flash={data.flash}
          light={data.light}
          o={data.o}
          selected={data.selected}
        />
        <span
          className="star-label line-clamp-2"
          style={{
            color: bright || data.selected ? TEXT : TEXT_DIM,
            fontWeight: data.light === "full" ? 500 : 400,
            marginLeft: data.light === "full" ? 30 : 27,
          }}
        >
          {data.label}
        </span>
      </div>
      <Handle position={Position.Bottom} style={STAR_HANDLE} type="source" />
    </>
  );
}

// 直线边；端点由 useStarField 跟着两头的星一起挪
function StarEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps<StarEdgeType>) {
  return (
    <>
      <BaseEdge
        data-base={`${sourceX},${sourceY},${targetX},${targetY}`}
        data-source={source}
        data-target={target}
        id={id}
        path={`M${sourceX},${sourceY} L${targetX},${targetY}`}
        style={style}
      />
      {data?.label ? (
        <text
          fill={CONFUSABLE}
          fontSize={11}
          textAnchor="middle"
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 8}
        >
          {data.label}
        </text>
      ) : null}
    </>
  );
}

const NODE_TYPES = { lesson: LessonNode, point: PointNode };
const EDGE_TYPES = { star: StarEdge };

// 选中点的先修链：沿“先修”往前、沿“属于”往总概念找
function chainOf(edges: Edge[], id: string) {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const edge of edges) {
      const next =
        edge.type === "prereq" && edge.to === current
          ? edge.from
          : edge.type === "part_of" && edge.from === current
            ? edge.to
            : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

// 鼠标力场：不走 React 渲染，每帧直接改网格折线、星的 transform 和边的端点。
// 鼠标在里面时很快跟上；离开后强度慢慢降到 0（约 1.5 秒），一切回到原位
function useStarField(
  boxRef: React.RefObject<HTMLDivElement | null>,
  gridRef: React.RefObject<SVGSVGElement | null>,
  flow: ReactFlowInstance | null
) {
  const mouse = useRef({ s: 0, ts: 0, tx: 0, ty: 0, x: 0, y: 0 });
  const running = useRef(false);

  const draw = useCallback(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!(box && grid && flow)) {
      return;
    }
    const m = mouse.current;
    const field = (x: number, y: number) => {
      if (m.s < 0.001) {
        return { d: Number.POSITIVE_INFINITY, dx: 0, dy: 0, f: 0 };
      }
      const dx = x - m.x;
      const dy = y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      const f =
        m.s *
        FIELD_PUSH *
        Math.exp(-(d * d) / (2 * FIELD_RADIUS * FIELD_RADIUS));
      return { d, dx, dy, f };
    };

    // 网格：屏幕坐标，跟着视野平移缩放，再被力场推弯
    const { x: vx, y: vy, zoom } = flow.getViewport();
    const width = box.clientWidth;
    const height = box.clientHeight;
    let step = GRID_STEP * zoom;
    while (step < 24) {
      step *= 2;
    }
    const lines: string[] = [];
    const bend = (x: number, y: number) => {
      const { d, dx, dy, f } = field(x, y);
      return f === 0
        ? `${x.toFixed(1)},${y.toFixed(1)}`
        : `${(x + (dx / d) * f).toFixed(1)},${(y + (dy / d) * f).toFixed(1)}`;
    };
    const major = step * 4;
    for (
      let x = (((vx % step) + step) % step) - step;
      x <= width + step;
      x += step
    ) {
      const points: string[] = [];
      for (let y = -GRID_SAMPLE; y <= height + GRID_SAMPLE; y += GRID_SAMPLE) {
        points.push(bend(x, y));
      }
      const isMajor = Math.abs(((x - vx) % major) + major) % major < 1;
      lines.push(
        `<polyline fill="none" stroke="${isMajor ? GRID_MAJOR : GRID}" points="${points.join(" ")}"/>`
      );
    }
    for (
      let y = (((vy % step) + step) % step) - step;
      y <= height + step;
      y += step
    ) {
      const points: string[] = [];
      for (let x = -GRID_SAMPLE; x <= width + GRID_SAMPLE; x += GRID_SAMPLE) {
        points.push(bend(x, y));
      }
      const isMajor = Math.abs(((y - vy) % major) + major) % major < 1;
      lines.push(
        `<polyline fill="none" stroke="${isMajor ? GRID_MAJOR : GRID}" points="${points.join(" ")}"/>`
      );
    }
    grid.innerHTML = lines.join("");

    // 星：在屏幕上算位移，写进节点内层时除以缩放
    const moved = new Map<string, { x: number; y: number }>();
    for (const el of box.querySelectorAll<HTMLElement>(
      ".react-flow__node-point"
    )) {
      const id = el.dataset.id ?? "";
      const node = flow.getInternalNode(id);
      const body = el.querySelector<HTMLElement>(".star-body");
      if (!(node && body)) {
        continue;
      }
      const abs = node.internals.positionAbsolute;
      const sx = (abs.x + STAR_X) * zoom + vx;
      const sy = (abs.y + STAR_Y) * zoom + vy;
      const { d, dx, dy, f } = field(sx, sy);
      const k =
        Math.min(f * 0.35, STAR_MAX) *
        Math.min(1, Math.max(0, (d - STAR_STILL) / 50));
      const ox = k === 0 ? 0 : ((dx / d) * k) / zoom;
      const oy = k === 0 ? 0 : ((dy / d) * k) / zoom;
      moved.set(id, { x: ox, y: oy });
      body.style.transform =
        ox === 0 && oy === 0
          ? ""
          : `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
    }

    // 边：端点跟两头的星挪同样的距离
    for (const path of box.querySelectorAll<SVGPathElement>(
      "path[data-base]"
    )) {
      const [x1, y1, x2, y2] = (path.dataset.base ?? "").split(",").map(Number);
      const a = moved.get(path.dataset.source ?? "") ?? { x: 0, y: 0 };
      const b = moved.get(path.dataset.target ?? "") ?? { x: 0, y: 0 };
      path.setAttribute(
        "d",
        `M${x1 + a.x},${y1 + a.y} L${x2 + b.x},${y2 + b.y}`
      );
    }
  }, [boxRef, gridRef, flow]);

  const tick = useCallback(() => {
    const m = mouse.current;
    m.x += (m.tx - m.x) * 0.22;
    m.y += (m.ty - m.y) * 0.22;
    m.s += (m.ts - m.s) * (m.ts > m.s ? 0.12 : 0.05);
    const still =
      Math.abs(m.ts - m.s) < 0.002 && Math.hypot(m.tx - m.x, m.ty - m.y) < 0.2;
    if (still && m.ts === 0) {
      m.s = 0;
    }
    draw();
    if (still) {
      running.current = false;
      return;
    }
    requestAnimationFrame(tick);
  }, [draw]);

  const wake = useCallback(() => {
    if (!running.current) {
      running.current = true;
      requestAnimationFrame(tick);
    }
  }, [tick]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.pointerType !== "mouse" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const m = mouse.current;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (m.ts === 0) {
        m.x = x;
        m.y = y;
      }
      m.tx = x;
      m.ty = y;
      m.ts = 1;
      wake();
    },
    [wake]
  );
  const onPointerLeave = useCallback(() => {
    mouse.current.ts = 0;
    wake();
  }, [wake]);

  return { draw, onPointerLeave, onPointerMove };
}

export function GraphPanel({
  graph,
  selectedId,
  onSelect,
  lights,
  progress,
  focusId,
  plainTitles,
}: {
  graph: CourseGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  lights?: Record<string, Light>;
  // 每个点的自主掌握 O，有值就画进度细弧
  progress?: Record<string, number>;
  // 变了就把视野移到这个点上
  focusId?: string;
  // 块标题不加“第 N 课”（我的星图）
  plainTitles?: boolean;
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

  // 点空白不取消选中（容易误触），按 Esc 才取消
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedId) {
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, selectedId]);

  const boxRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<SVGSVGElement>(null);
  const field = useStarField(boxRef, gridRef, flow);
  const { draw } = field;

  // 网格跟着容器大小变化重画
  useEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver(() => draw());
    observer.observe(box);
    return () => observer.disconnect();
  }, [draw]);

  const layout = useMemo(
    () => layoutGraph(graph, { plainTitles }),
    [graph, plainTitles]
  );
  const isLit = useCallback(
    (id: string) => lights?.[id] === "half" || lights?.[id] === "full",
    [lights]
  );

  const nodes = useMemo<FlowNode[]>(
    () => [
      ...layout.lessons.map((lesson) => {
        const points = graph.points.filter((p) => p.lessonId === lesson.id);
        return {
          data: {
            label: lesson.title,
            lit: lights
              ? `已点亮 ${points.filter((p) => isLit(p.id)).length} / ${points.length}`
              : undefined,
          },
          draggable: false,
          id: `lesson:${lesson.id}`,
          position: { x: 0, y: lesson.y },
          selectable: false,
          style: {
            background: "transparent",
            border: "1px dashed #3a3a40",
            borderRadius: 4,
            color: "#e9e6df",
            fontSize: 14,
            fontWeight: 600,
            height: lesson.height,
            padding: 12,
            width: lesson.width,
          },
          type: "lesson",
        };
      }),
      ...graph.points.map((point) => ({
        className: "star-node",
        data: {
          flash: flashing.includes(point.id),
          label: point.name,
          light: lights?.[point.id] ?? "gray",
          o: progress?.[point.id],
          selected: point.id === selectedId,
        },
        id: point.id,
        parentId: `lesson:${point.lessonId}`,
        position: layout.positions[point.id] ?? { x: 0, y: 0 },
        style: {
          background: "transparent",
          border: "none",
          fontSize: 13,
          height: NODE_HEIGHT,
          lineHeight: 1.25,
          width: NODE_WIDTH,
        },
        type: "point",
      })),
    ],
    [graph, layout, selectedId, lights, progress, flashing, isLit]
  );

  const edges = useMemo<StarEdgeType[]>(() => {
    const lessonOf = new Map(graph.points.map((p) => [p.id, p.lessonId]));
    const chain = selectedId ? chainOf(graph.edges, selectedId) : new Set();
    return graph.edges.flatMap<StarEdgeType>((edge) => {
      const touched =
        selectedId !== null &&
        (edge.from === selectedId || edge.to === selectedId);
      // 跨课的线和“易混”线默认收起，选中相关的点时才画
      const crossLesson = lessonOf.get(edge.from) !== lessonOf.get(edge.to);
      if ((edge.type === "confusable" || crossLesson) && !touched) {
        return [];
      }
      const id = `${edge.type}:${edge.from}:${edge.to}`;
      if (edge.type === "confusable") {
        return [
          {
            data: { label: "易混" },
            id,
            source: edge.from,
            style: {
              stroke: CONFUSABLE,
              strokeDasharray: "1 4",
              strokeLinecap: "round" as const,
              strokeWidth: 1.2,
            },
            target: edge.to,
            type: "star",
          },
        ];
      }
      const bothLit = isLit(edge.from) && isLit(edge.to);
      const inChain = chain.has(edge.from) && chain.has(edge.to);
      return [
        {
          id,
          source: edge.from,
          style: {
            stroke: bothLit ? LIT_LINE : inChain || touched ? CHAIN : LINE,
            strokeDasharray:
              edge.type === "part_of"
                ? "3 3"
                : inChain && !bothLit
                  ? "5 3"
                  : undefined,
            strokeWidth: bothLit ? 1.4 : inChain || touched ? 1.2 : 1,
          },
          target: edge.to,
          type: "star",
        },
      ];
    });
  }, [graph, selectedId, isLit]);

  // 数据或视野变了，按当前力场重画一帧（边的位置由 React Flow 重新给出）
  useEffect(() => {
    if (nodes.length + edges.length > 0) {
      requestAnimationFrame(draw);
    }
  }, [draw, nodes, edges]);

  const onNodeClick = useCallback(
    (_: unknown, node: FlowNode) => {
      if (!node.id.startsWith("lesson:")) {
        onSelect(node.id);
      }
    },
    [onSelect]
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-testid="star-map"
      onPointerLeave={field.onPointerLeave}
      onPointerMove={field.onPointerMove}
      ref={boxRef}
      style={{ background: SKY }}
    >
      <StarDefs />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        ref={gridRef}
      />
      <ReactFlow
        colorMode="dark"
        edges={edges}
        edgeTypes={EDGE_TYPES}
        fitView
        minZoom={0.1}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={NODE_TYPES}
        onInit={setFlow}
        onMove={draw}
        onNodeClick={onNodeClick}
        style={{ background: "transparent" }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
