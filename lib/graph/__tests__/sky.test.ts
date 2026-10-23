import { describe, expect, it } from "vitest";
import type { CourseGraph } from "@/lib/types";
import { layoutSky, starField } from "../sky";

function graphOf(sizes: number[]): CourseGraph {
  const lessons = sizes.map((_, i) => ({
    fileIds: [],
    id: `lesson_${i + 1}`,
    index: i + 1,
    title: `第 ${i + 1} 课`,
  }));
  const points = sizes.flatMap((n, i) =>
    Array.from({ length: n }, (_, j) => ({
      aliases: [],
      checkQuestions: [],
      definition: "",
      id: `kp_${i}_${j}`,
      kind: "concept" as const,
      lessonId: `lesson_${i + 1}`,
      name: `点 ${j}`,
      sources: [
        { fileId: "f", lessonId: `lesson_${i + 1}`, page: 1, quote: "q" },
      ],
      status: "auto" as const,
    }))
  );
  return {
    builtAt: "",
    courseId: "c",
    edges: [],
    lessons,
    name: "c",
    points,
  } as CourseGraph;
}

describe("星图排版", () => {
  const graph = graphOf([23, 25, 13]);

  it("每次排出来都一样", () => {
    expect(layoutSky(graph)).toEqual(layoutSky(graph));
  });

  it("每颗星都在单位方块里，课内星不重叠", () => {
    const { lessons, unit } = layoutSky(graph);
    for (const lesson of lessons) {
      const pts = lesson.pointIds.map((id) => unit[id]);
      for (const p of pts) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1);
      }
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          expect(
            Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
          ).toBeGreaterThan(0.08);
        }
      }
    }
  });

  it("星座连线是一棵树：n 颗星 n-1 条线", () => {
    const { lessons } = layoutSky(graph);
    expect(lessons.map((l) => l.lines.length)).toEqual([22, 24, 12]);
  });

  it("背景暗星大多很暗很小", () => {
    const field = starField(640, 440, 800);
    const faint = field.filter((s) => s.r < 0.6).length;
    expect(faint / field.length).toBeGreaterThan(0.5);
  });
});
