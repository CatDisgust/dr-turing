import "server-only";
import { z } from "zod";
import type { KnowledgePoint } from "@/lib/types";
import { askJson } from "./ask";

// 给每个知识点配检查题，辅导时“问一句看懂没懂”用。一课一次请求，各课并行。
// 不再预先猜“常见误解”：错误想法只从学生自己的错答里提，记在学生身上（用户 2026-10-22）

const enrichSchema = z.object({
  items: z.array(
    z.object({
      checkQuestions: z.array(z.string()),
      id: z.string(),
    })
  ),
});

const ENRICH_PROMPT = `下面是一节课的知识点。每行：id｜名称｜定义｜课件原文摘句。

给每个知识点写：
- checkQuestions：1 到 2 道检查题。用中文，学生一两句话就能答，能看出他是真懂还是背了定义。别问“X 的定义是什么”，问要用到它的情境或对比，例如“两个人同时改同一行数据，乐观并发控制会怎么发现冲突？”。答案要能从课件内容推出来。
每个知识点都要有一条，id 照抄。`;

const brief = (point: KnowledgePoint) =>
  `${point.id}｜${point.name}｜${point.definition}｜${point.sources
    .slice(0, 2)
    .map((s) => s.quote)
    .join(" / ")}`;

export async function enrichPoints(
  points: KnowledgePoint[]
): Promise<{ points: KnowledgePoint[]; missing: string[] }> {
  const byLesson = new Map<string, KnowledgePoint[]>();
  for (const point of points) {
    byLesson.set(point.lessonId, [
      ...(byLesson.get(point.lessonId) ?? []),
      point,
    ]);
  }
  const results = await Promise.all(
    [...byLesson.values()].map((lessonPoints) =>
      askJson(
        [
          {
            text: `${ENRICH_PROMPT}\n\n${lessonPoints.map(brief).join("\n")}`,
            type: "text",
          },
        ],
        enrichSchema
      )
    )
  );

  const byId = new Map(results.flatMap((r) => r.items).map((i) => [i.id, i]));
  const missing: string[] = [];
  const enriched = points.map((point) => {
    const item = byId.get(point.id);
    if (!item) {
      missing.push(point.id);
      return point;
    }
    // 数量按规划卡死：检查题最多 2 道
    return {
      ...point,
      checkQuestions: item.checkQuestions.filter(Boolean).slice(0, 2),
    };
  });
  return { missing, points: enriched };
}
