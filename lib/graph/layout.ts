import dagre from "@dagrejs/dagre";
import type { CourseGraph } from "@/lib/types";

// 排版：每课一块，从上到下排；块内用 dagre 按“先修 / 属于”自上而下分层，
// 课内没有边的孤立点按网格排在下面，免得 dagre 把它们排成一长行。
// 跨课的边只画，不参与排版。

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 44;
const PADDING = 24;
const TITLE_HEIGHT = 36;
const GAP = 60;
const GRID_COLUMNS = 6;
const GRID_GAP = 16;

export type LessonBox = {
  id: string;
  title: string;
  y: number;
  width: number;
  height: number;
};

export type GraphLayout = {
  lessons: LessonBox[];
  // 节点相对所在课块左上角的位置
  positions: Record<string, { x: number; y: number }>;
};

// plainTitles：块标题只用 title，不加“第 N 课”（我的星图按课程和课外分块）
export function layoutGraph(
  graph: CourseGraph,
  { plainTitles = false }: { plainTitles?: boolean } = {}
): GraphLayout {
  const lessons: LessonBox[] = [];
  const positions: GraphLayout["positions"] = {};
  let y = 0;

  for (const lesson of [...graph.lessons].sort((a, b) => a.index - b.index)) {
    const points = graph.points.filter((p) => p.lessonId === lesson.id);
    if (points.length === 0) {
      continue;
    }
    const ids = new Set(points.map((p) => p.id));
    const lessonEdges = graph.edges.filter(
      (e) => e.type !== "confusable" && ids.has(e.from) && ids.has(e.to)
    );
    const linked = new Set(lessonEdges.flatMap((e) => [e.from, e.to]));

    const g = new dagre.graphlib.Graph();
    g.setGraph({ nodesep: 16, rankdir: "TB", ranksep: 48 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const id of linked) {
      g.setNode(id, { height: NODE_HEIGHT, width: NODE_WIDTH });
    }
    for (const edge of lessonEdges) {
      // 先修在上；“属于”把总概念放在子概念上面
      if (edge.type === "prereq") {
        g.setEdge(edge.from, edge.to);
      } else {
        g.setEdge(edge.to, edge.from);
      }
    }
    dagre.layout(g);

    let width = 0;
    let height = TITLE_HEIGHT;
    for (const id of linked) {
      const node = g.node(id);
      const px = node.x - NODE_WIDTH / 2 + PADDING;
      const py = node.y - NODE_HEIGHT / 2 + PADDING + TITLE_HEIGHT;
      positions[id] = { x: px, y: py };
      width = Math.max(width, px + NODE_WIDTH + PADDING);
      height = Math.max(height, py + NODE_HEIGHT);
    }

    const isolated = points.filter((p) => !linked.has(p.id));
    const gridTop = height + (linked.size > 0 ? GAP / 2 : PADDING);
    isolated.forEach((point, i) => {
      const px = PADDING + (i % GRID_COLUMNS) * (NODE_WIDTH + GRID_GAP);
      const py =
        gridTop + Math.floor(i / GRID_COLUMNS) * (NODE_HEIGHT + GRID_GAP);
      positions[point.id] = { x: px, y: py };
      width = Math.max(width, px + NODE_WIDTH + PADDING);
      height = Math.max(height, py + NODE_HEIGHT);
    });
    height += PADDING;

    lessons.push({
      height,
      id: lesson.id,
      title: plainTitles
        ? lesson.title
        : `第 ${lesson.index} 课 ${lesson.title}`,
      width,
      y,
    });
    y += height + GAP;
  }

  return { lessons, positions };
}
