import "server-only";
import { z } from "zod";
import type { KnowledgePoint } from "@/lib/types";
import { askJson } from "./ask";
import { cleanEdges } from "./cycles";

const edgesSchema = z.object({
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      // prereq：学 to 之前要先懂 from；part_of：from 是 to 的一部分；confusable：学生容易把两者搞混
      type: z.string(),
    })
  ),
});

const EDGES_PROMPT = `下面是一门课的全部知识点。每行：id｜课｜名称｜别名｜定义。

找出知识点之间的三种关系：
- prereq：不先懂 from，就学不懂 to。只标真正必需的直接前提，不要标“有关”，也不要把能经别的点间接推出的前提再标一遍。
- part_of：from 是 to 的一个组成部分或一个子类（例如某个具体的质量属性 part_of 质量属性）。
- confusable：学生容易把 from 和 to 搞混或对比着问（例如乐观和悲观并发控制）。
from 和 to 都用上面的 id。宁缺毋滥。`;

// 返回留下的边和丢掉的边（丢的原因写清楚，方便看模型哪里出错）
export async function inferEdges(
  points: KnowledgePoint[]
): Promise<ReturnType<typeof cleanEdges>> {
  const list = points
    .map(
      (p) =>
        `${p.id}｜${p.lessonId}｜${p.name}｜${p.aliases.join(" / ")}｜${p.definition}`
    )
    .join("\n");
  const { edges } = await askJson(
    [{ text: `${EDGES_PROMPT}\n\n${list}`, type: "text" }],
    edgesSchema
  );
  return cleanEdges(
    edges.flatMap((edge) =>
      edge.type === "prereq" ||
      edge.type === "part_of" ||
      edge.type === "confusable"
        ? [{ ...edge, status: "tentative" as const, type: edge.type }]
        : []
    ),
    new Set(points.map((p) => p.id))
  );
}
