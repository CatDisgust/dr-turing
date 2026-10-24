"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NodeDrawer } from "@/components/graph/node-drawer";
import { PersonalPanel } from "@/components/graph/personal-panel";
import { SkyMap } from "@/components/graph/sky-map";
import { useLearnerState } from "@/hooks/use-learner-state";
import { GRADED_EVENT, NODE_TOUCHED_EVENT } from "@/lib/constants";
import { type Light, nodeLight } from "@/lib/learner/light";
import type { CourseGraph } from "@/lib/types";

type Graded = {
  kpId: string;
  name: string;
  correct: boolean;
  misconception?: string;
  confidence?: "guess" | "somewhat" | "sure";
};

// 聊天右边的图谱：按当前学生的状态点亮，画成星图（sky-map.tsx）。归类一到就先把那个点当“正在学”，
// 批改完、回答结束再从库里刷新。很确定却答错的那颗标成“以为会了”。点一颗星打开抽屉，看证据原话
export function LearnerGraph({
  courseId,
  sessionId,
  onStartLearning,
}: {
  courseId: string;
  sessionId: string;
  // 抽屉里点“开始学习”时调用，由对话那边发消息
  onStartLearning?: (kpId: string, name: string) => void;
}) {
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const state = useLearnerState(courseId);
  const [touched, setTouched] = useState<{ kpId: string; name: string }>();
  const [graded, setGraded] = useState<Graded>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/course/${courseId}`)
      .then((response) => response.json())
      .then((body) => setGraph(body.graph ?? null))
      .catch(() => setGraph(null));
  }, [courseId]);

  useEffect(() => {
    const onTouched = (event: Event) => {
      const { detail } = event as CustomEvent<{ kpId: string; name: string }>;
      setTouched(detail);
      setSelectedId(detail.kpId);
    };
    const onGraded = (event: Event) => {
      setGraded((event as CustomEvent<Graded>).detail);
    };
    window.addEventListener(NODE_TOUCHED_EVENT, onTouched);
    window.addEventListener(GRADED_EVENT, onGraded);
    return () => {
      window.removeEventListener(NODE_TOUCHED_EVENT, onTouched);
      window.removeEventListener(GRADED_EVENT, onGraded);
    };
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setOpenId(id);
  }, []);
  const close = useCallback(() => setOpenId(null), []);
  const start = useCallback(() => {
    const point = graph?.points.find((p) => p.id === openId);
    if (point && onStartLearning) {
      onStartLearning(point.id, point.name);
      setOpenId(null);
    }
  }, [graph, openId, onStartLearning]);
  const lights = useMemo(() => {
    const result: Record<string, Light> = {};
    for (const point of graph?.points ?? []) {
      result[point.id] = nodeLight(state?.nodes[point.id], sessionId).light;
    }
    // 库里还没刷到也先亮起来
    if (touched && result[touched.kpId] === "gray") {
      result[touched.kpId] = "dashed";
    }
    return result;
  }, [graph, state, sessionId, touched]);

  const progress = useMemo(() => {
    const result: Record<string, number> = {};
    for (const [id, node] of Object.entries(state?.nodes ?? {})) {
      result[id] = node.O;
    }
    return result;
  }, [state]);

  const openPoint = graph?.points.find((p) => p.id === openId);
  const warnId =
    graded && !graded.correct && graded.confidence === "sure"
      ? graded.kpId
      : undefined;

  if (!graph) {
    return (
      <div className="p-4 text-[14px] text-[var(--sky-ink-2)]">
        这门课的图谱还没生成。
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="learner-graph">
      <SkyMap
        currentId={touched?.kpId}
        graph={graph}
        lights={lights}
        onSelect={select}
        progress={progress}
        selectedId={selectedId}
        warnId={warnId}
      />
      <PersonalPanel />
      {openPoint ? (
        <NodeDrawer
          node={state?.nodes[openPoint.id]}
          onClose={close}
          onStart={onStartLearning ? start : undefined}
          point={openPoint}
          sessionId={sessionId}
        />
      ) : null}
    </div>
  );
}
