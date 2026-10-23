"use client";

import { useEffect, useMemo, useState } from "react";
import { useLearnerState } from "@/hooks/use-learner-state";
import { COURSE_ID, NODE_TOUCHED_EVENT } from "@/lib/constants";
import { nodeLight } from "@/lib/learner/light";
import type { CourseGraph } from "@/lib/types";

// 页头的本课进度（视觉规范 LessonProgress）：课名 + 一条分段进度条，先“真会”再“看懂”。
// 哪一课：这次对话正在讲的点所在的课（刚归类到的点，否则是最后一条导师回答的目标点）。
// 这次对话还没碰到课里的点（新对话、问课外的东西）就什么都不显示，不拿别的对话的课来充数
export function LessonProgress({ targetId }: { targetId?: string }) {
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const state = useLearnerState();
  const [touchedId, setTouchedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/course/${COURSE_ID}`)
      .then((response) => response.json())
      .then((body) => setGraph(body.graph ?? null))
      .catch(() => setGraph(null));
  }, []);

  useEffect(() => {
    const onTouched = (event: Event) =>
      setTouchedId((event as CustomEvent<{ kpId: string }>).detail.kpId);
    window.addEventListener(NODE_TOUCHED_EVENT, onTouched);
    return () => window.removeEventListener(NODE_TOUCHED_EVENT, onTouched);
  }, []);

  const summary = useMemo(() => {
    if (!graph) {
      return null;
    }
    const pointId = touchedId ?? targetId;
    const lessonId = graph.points.find((p) => p.id === pointId)?.lessonId;
    const lesson = graph.lessons.find((l) => l.id === lessonId);
    if (!lesson) {
      return null;
    }
    const points = graph.points.filter((p) => p.lessonId === lesson.id);
    let full = 0;
    let half = 0;
    for (const point of points) {
      const { light } = nodeLight(state?.nodes[point.id]);
      if (light === "full") {
        full += 1;
      } else if (light === "half") {
        half += 1;
      }
    }
    return {
      full,
      half,
      label: `第 ${lesson.index} 课 · ${lesson.title}`,
      total: points.length,
    };
  }, [graph, state, touchedId, targetId]);

  if (!summary || summary.total === 0) {
    return null;
  }
  const { full, half, label, total } = summary;
  return (
    <>
      <span
        className="hidden min-w-[7em] max-w-[220px] truncate text-[14px] text-muted-foreground md:inline"
        data-testid="lesson-name"
      >
        {label}
      </span>
      <span className="flex-1" />
      <div className="hidden items-center gap-2.5 lg:flex">
        <div
          aria-label={`${total} 个知识点：${full} 个真会，${half} 个看懂`}
          className="flex h-2.5 w-[140px] shrink-0 overflow-hidden rounded-[5px] bg-border"
          role="img"
        >
          <span
            className="bg-[var(--duo-green)] transition-[width] duration-500"
            style={{ width: `${(full / total) * 100}%` }}
          />
          <span
            className="bg-[var(--duo-green-half)] transition-[width] duration-500"
            style={{ width: `${(half / total) * 100}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-[13px] text-muted-foreground tabular-nums">
          {full} 真会 · {half} 看懂 / {total}
        </span>
      </div>
    </>
  );
}
