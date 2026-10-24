import { describe, expect, it } from "vitest";
import type { CourseGraph } from "@/lib/types";
import { namespacePoints } from "../namespace";

const point = (id: string) => ({
  aliases: [],
  checkQuestions: [],
  definition: "",
  id,
  kind: "concept" as const,
  lessonId: "l1",
  name: id,
  sources: [{ fileId: "f", lessonId: "l1", page: 1, quote: "q" }],
  status: "auto" as const,
});

const graphOf = (courseId: string): CourseGraph => ({
  builtAt: "",
  courseId,
  edges: [
    { from: "kp_l1_1", status: "tentative", to: "kp_l1_2", type: "prereq" },
  ],
  lessons: [],
  name: courseId,
  points: [point("kp_l1_1"), point("kp_l1_2")],
});

describe("namespacePoints", () => {
  it("新课的知识点编号和边都带上课 id，两门课不再撞号", () => {
    const g = namespacePoints(graphOf("os101-hkc7"));
    expect(g.points.map((p) => p.id)).toEqual([
      "kp_os101-hkc7_l1_1",
      "kp_os101-hkc7_l1_2",
    ]);
    expect(g.edges[0]).toMatchObject({
      from: "kp_os101-hkc7_l1_1",
      to: "kp_os101-hkc7_l1_2",
    });
    const other = namespacePoints(graphOf("db202-abcd"));
    expect(other.points[0].id).not.toBe(g.points[0].id);
  });

  it("再跑一次不会重复加", () => {
    const once = namespacePoints(graphOf("os101-hkc7"));
    expect(namespacePoints(once)).toEqual(once);
  });

  it("COMP5348 的旧编号不动", () => {
    expect(namespacePoints(graphOf("comp5348")).points[0].id).toBe("kp_l1_1");
  });
});
