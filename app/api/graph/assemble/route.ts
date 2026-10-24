import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import gold from "@/fixtures/gold/comp5348-w1-w3.json";
import {
  bumpGenerations,
  courseHasLearners,
  saveCourse,
} from "@/lib/db/queries";
import { makeCourseId } from "@/lib/graph/course-id";
import { inferEdges } from "@/lib/graph/edges";
import { enrichPoints } from "@/lib/graph/enrich";
import { matchLesson } from "@/lib/graph/match";
import { namespacePoints } from "@/lib/graph/namespace";
import { scoreGraph } from "@/lib/graph/score";
import { trialUploadBlock } from "@/lib/graph/upload-guard";
import { OWN_LIMITS } from "@/lib/own-course";
import { auth } from "@/lib/session";
import { chargeTo } from "@/lib/spend";
import {
  type CourseGraph,
  knowledgePointSchema,
  lessonSchema,
} from "@/lib/types";

// 把每课抽好的知识点合成一张图：逐课 match → 连边、补检查题 → 存库 → 对金标准打分。
// 抽取在 /api/graph/extract 里每课各跑一次（可并行），这里只做合并，所以请求体很小
export const maxDuration = 300;

const bodySchema = z.object({
  courseId: z.string().min(1).optional(),
  lessons: z.array(
    z.object({
      accepted: z.array(knowledgePointSchema),
      lesson: lessonSchema,
    })
  ),
  name: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  chargeTo(session.user.id);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "请求格式不对" }, { status: 400 });
  }
  const body = parsed.data;
  // 试用同学只能新建自己的课，不能改别的课；课数和次数在这里再查一遍
  const owner = session.invite ? session.user.id : undefined;
  if (session.invite) {
    const blocked =
      body.courseId === undefined
        ? await trialUploadBlock(session)
        : "只能新建自己的课";
    if (blocked) {
      return Response.json({ error: blocked }, { status: 403 });
    }
    if (body.lessons.length > OWN_LIMITS.lessons) {
      return Response.json(
        { error: `一门课最多 ${OWN_LIMITS.lessons} 课` },
        { status: 400 }
      );
    }
  }
  // 有人学过的课不许原地重新生成：知识点编号会指到别的点上，学生的亮度跟着挂错
  if (body.courseId && (await courseHasLearners(body.courseId))) {
    return Response.json(
      { error: "这门课已经有人学过，不能原地重新生成。要更新就新建一门课。" },
      { status: 409 }
    );
  }
  // 管理页加新课不带 id，这里起一个新的；/graph 自测页带 id 就是重新生成那门课
  const courseId = body.courseId ?? makeCourseId(body.name);
  const lessons = [...body.lessons].sort(
    (a, b) => a.lesson.index - b.lesson.index
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const timings: Record<string, number> = {};
      const time = async <T>(label: string, run: () => Promise<T>) => {
        send({ step: label });
        const startedAt = Date.now();
        const result = await run();
        timings[label] = Date.now() - startedAt;
        return result;
      };

      try {
        // 一课一课往图里加，后一课要和前面合并完的图比，只能顺序跑
        let points: CourseGraph["points"] = [];
        const merged: { from: string; into: string }[] = [];
        for (const { lesson, accepted } of lessons) {
          // biome-ignore lint/performance/noAwaitInLoops: 依赖上一课的结果
          const result = await time(`合并第 ${lesson.index} 课`, () =>
            matchLesson(points, accepted)
          );
          ({ points } = result);
          merged.push(...result.merged);
        }

        // 连边和补检查题互不依赖，一起跑
        const [{ edges, dropped }, enriched] = await Promise.all([
          time("连边", () => inferEdges(points)),
          time("补检查题和误解", () => enrichPoints(points)),
        ]);
        ({ points } = enriched);

        const graph: CourseGraph = namespacePoints({
          builtAt: new Date().toISOString(),
          courseId,
          edges,
          lessons: lessons.map(({ lesson }) => lesson),
          name: body.name,
          points,
        });

        let saved = true;
        try {
          await saveCourse({
            files: lessons.flatMap(({ lesson }) => lesson.fileIds),
            graph,
            ownerId: owner,
          });
          if (session.invite) {
            await bumpGenerations(session.invite.code);
          }
        } catch (error) {
          console.error("save course error:", error);
          saved = false;
        }

        send({
          done: true,
          droppedEdges: dropped,
          graph,
          merged,
          notEnriched: enriched.missing,
          saved,
          score: courseId === "comp5348" ? scoreGraph(graph, gold) : null,
          timings,
        });
      } catch (error) {
        console.error("graph assemble error:", error);
        const message =
          error instanceof Anthropic.APIError
            ? `Anthropic ${error.status ?? "网络"}：${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
