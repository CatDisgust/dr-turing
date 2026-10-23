import type { CourseGraph } from "@/lib/types";

// 星图排版（视觉规范「我的星图」）：一课是一个星座，一个知识点是一颗星。
// 星的位置按课内单位方块 [0,1]² 算一次，用固定种子随机撒点、保持最小间距，所以每次打开都一样；
// 画的时候再把单位方块放进“整门课一片天”里那一课的横带，或者放进“本课近景”的整块画面。
// 星座的连线不是先修关系，只是把离得近的星连成一棵最小生成树，让它看起来像星座

export type SkyPoint = { x: number; y: number };

export type SkyLesson = {
  id: string;
  index: number;
  title: string;
  pointIds: string[];
  lines: [string, string][];
};

export type SkyLayout = {
  lessons: SkyLesson[];
  // 课内单位方块里的位置
  unit: Record<string, SkyPoint>;
};

// mulberry32：给一个种子，出一串固定的 [0,1) 随机数
export function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashString(text: string) {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16_777_619);
  }
  return h >>> 0;
}

const MARGIN = 0.06;
const TRIES = 400;

// 横向距离打折算：名字写在星的右边，同一高度的两颗星要离得更远，名字才不会叠在一起
const X_WEIGHT = 0.55;

// 在单位方块里撒 n 个点，两两至少隔 gap（横向按 X_WEIGHT 打折）；撒不下就把间距放小再试
function scatter(n: number, seed: number): SkyPoint[] {
  let gap = Math.min(0.32, 0.9 / Math.sqrt(Math.max(n, 1)));
  for (;;) {
    const rnd = seeded(seed);
    const points: SkyPoint[] = [];
    for (let tries = 0; points.length < n && tries < TRIES * n; tries += 1) {
      const p = {
        x: MARGIN + rnd() * (1 - 2 * MARGIN),
        y: MARGIN + rnd() * (1 - 2 * MARGIN),
      };
      if (
        points.every(
          (q) => Math.hypot((p.x - q.x) * X_WEIGHT, p.y - q.y) >= gap
        )
      ) {
        points.push(p);
      }
    }
    if (points.length === n) {
      return points;
    }
    gap *= 0.9;
  }
}

// Prim 最小生成树：返回连线的下标对
function spanningTree(points: SkyPoint[]): [number, number][] {
  if (points.length < 2) {
    return [];
  }
  const inTree = new Set([0]);
  const lines: [number, number][] = [];
  while (inTree.size < points.length) {
    let best: [number, number] | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const i of inTree) {
      for (let j = 0; j < points.length; j += 1) {
        if (inTree.has(j)) {
          continue;
        }
        const d = Math.hypot(
          points[i].x - points[j].x,
          points[i].y - points[j].y
        );
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (!best) {
      break;
    }
    inTree.add(best[1]);
    lines.push(best);
  }
  return lines;
}

export function layoutSky(graph: CourseGraph): SkyLayout {
  const unit: SkyLayout["unit"] = {};
  const lessons = [...graph.lessons]
    .sort((a, b) => a.index - b.index)
    .map((lesson) => {
      // 按 id 排，图谱里点的顺序变了位置也不变
      const pointIds = graph.points
        .filter((p) => p.lessonId === lesson.id)
        .map((p) => p.id)
        .sort();
      const points = scatter(pointIds.length, hashString(lesson.id));
      pointIds.forEach((id, i) => {
        unit[id] = points[i];
      });
      const lines = spanningTree(points).map(
        ([a, b]) => [pointIds[a], pointIds[b]] as [string, string]
      );
      return {
        id: lesson.id,
        index: lesson.index,
        lines,
        pointIds,
        title: lesson.title,
      };
    });
  return { lessons, unit };
}

export type Rect = { x: number; y: number; width: number; height: number };

export function place(p: SkyPoint, rect: Rect): SkyPoint {
  return { x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height };
}

// 背景暗星：按星等分布（多数很暗很小），约 45% 落在一条从左下到右上的斜带里，像银河
export type FieldStar = {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
};

const FIELD_COLORS = [
  "#afc3ff",
  "#ccdbff",
  "#fffffe",
  "#fffffe",
  "#fff5ea",
  "#ffe1bf",
  "#ffcf96",
];

export function starField(
  count: number,
  width: number,
  height: number,
  seed = 21
): FieldStar[] {
  const rnd = seeded(seed);
  const stars: FieldStar[] = [];
  for (let i = 0; i < count; i += 1) {
    let x: number;
    let y: number;
    if (rnd() < 0.45) {
      const t = rnd();
      x = t * width;
      y = height - t * height * 0.8 + (rnd() + rnd() + rnd() - 1.5) * 110;
    } else {
      x = rnd() * width;
      y = rnd() * height;
    }
    const m = Math.max(1.8, 6.5 + 2 * Math.log10(Math.max(rnd(), 1e-6)));
    const d = Math.max(0.7, 2.4 * 10 ** (-0.2 * (m - 1.8)));
    stars.push({
      alpha: Math.min(0.85, 0.12 + (0.7 * (6.5 - m)) / 4.7),
      color: FIELD_COLORS[Math.floor(rnd() * FIELD_COLORS.length)],
      r: d / 2,
      x,
      y,
    });
  }
  return stars;
}
