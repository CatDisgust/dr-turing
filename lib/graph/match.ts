import "server-only";
import { z } from "zod";
import type { KnowledgePoint } from "@/lib/types";
import { askJson } from "./ask";

// iText2KG 的思路：一课一课往图里加，每个新知识点先和已有的比，是同一个就合并，不是才新建。
// 判断交给 Claude，不用向量。

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      // 新知识点的 id
      id: z.string(),
      // 与之相同的已有知识点 id；是新的就填空字符串
      sameAs: z.string(),
    })
  ),
});

const brief = (point: KnowledgePoint) =>
  `${point.id}｜${point.name}｜${point.aliases.join(" / ")}｜${point.definition}`;

const MATCH_PROMPT = `下面是一门课的知识点图谱里已有的知识点，和新一节课抽出来的知识点。每行：id｜名称｜别名｜定义。

对每个新知识点判断：它和某个已有知识点是不是同一个东西？
- 同一个：讲的是同一个概念，只是换了说法或在新一课里又提到。sameAs 填那个已有 id。
- 不是同一个：哪怕相关（一个是另一个的一部分、一个是另一个的前提、两者容易混），也算新的，sameAs 填空字符串。
- 新知识点之间如果彼此重复，第二个的 sameAs 填第一个的 id。
每个新知识点都要给一条判断。`;

export async function matchLesson(
  graph: KnowledgePoint[],
  incoming: KnowledgePoint[]
): Promise<{
  points: KnowledgePoint[];
  merged: { from: string; into: string }[];
}> {
  if (incoming.length === 0) {
    return { merged: [], points: graph };
  }

  const { decisions } = await askJson(
    [
      {
        text: `${MATCH_PROMPT}\n\n已有知识点：\n${
          graph.length > 0 ? graph.map(brief).join("\n") : "（无）"
        }\n\n新知识点：\n${incoming.map(brief).join("\n")}`,
        type: "text",
      },
    ],
    decisionSchema
  );

  const sameAs = new Map(decisions.map((d) => [d.id, d.sameAs]));
  const points = graph.map((point) => ({ ...point }));
  const byId = new Map(points.map((point) => [point.id, point]));
  const merged: { from: string; into: string }[] = [];

  for (const point of incoming) {
    const target = byId.get(sameAs.get(point.id) ?? "");
    if (target) {
      // 合并：出处和别名并进去，名字和所属课沿用先出现的那个
      target.sources = [...target.sources, ...point.sources];
      target.aliases = [
        ...new Set([...target.aliases, point.name, ...point.aliases]),
      ].filter((alias) => alias !== target.name);
      merged.push({ from: point.id, into: target.id });
    } else {
      const copy = { ...point };
      points.push(copy);
      byId.set(copy.id, copy);
    }
  }

  return { merged, points };
}
