"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GraphPanel,
  LIGHT_LEGEND,
  lightSwatch,
} from "@/components/graph/graph-panel";
import { NodeDrawer } from "@/components/graph/node-drawer";
import { PersonalPanel } from "@/components/graph/personal-panel";
import { useLearnerState } from "@/hooks/use-learner-state";
import { COURSE_ID, GRADED_EVENT, NODE_TOUCHED_EVENT } from "@/lib/constants";
import { type Light, nodeLight } from "@/lib/learner/light";
import type { CourseGraph } from "@/lib/types";

type Graded = {
  kpId: string;
  name: string;
  correct: boolean;
  misconception?: string;
};

// 聊天右边的图谱：按当前学生的状态点亮。归类一到就先把那个点虚线亮，批改完、回答结束再从库里刷新。
// 点一个节点打开抽屉，看证据原话
export function LearnerGraph({ sessionId }: { sessionId: string }) {
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const state = useLearnerState();
  const [touched, setTouched] = useState<{ kpId: string; name: string }>();
  const [graded, setGraded] = useState<Graded>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/course/${COURSE_ID}`)
      .then((response) => response.json())
      .then((body) => setGraph(body.graph ?? null))
      .catch(() => setGraph(null));
  }, []);

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

  const openPoint = graph?.points.find((p) => p.id === openId);

  if (!graph) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        这门课的图谱还没生成。
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="learner-graph">
      <GraphPanel
        focusId={touched?.kpId}
        graph={graph}
        lights={lights}
        onSelect={select}
        selectedId={selectedId}
      />
      {touched ? (
        <div
          className="absolute top-3 left-3 rounded-md border bg-background/90 px-2 py-1 text-xs"
          data-testid="touched-node"
        >
          这次在问：{touched.name}
          {graded?.kpId === touched.kpId ? (
            <span
              className={graded.correct ? "text-emerald-600" : "text-red-600"}
              data-testid="graded"
            >
              {graded.correct ? " · 答对了" : " · 没答对"}
              {graded.misconception
                ? `，像这个误解：${graded.misconception}`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      <PersonalPanel state={state} total={graph.points.length} />
      {openPoint ? (
        <NodeDrawer
          node={state?.nodes[openPoint.id]}
          onClose={close}
          point={openPoint}
          sessionId={sessionId}
        />
      ) : null}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-md border bg-background/90 p-2 text-xs">
        {LIGHT_LEGEND.map((item) => (
          <div className="flex items-center gap-2" key={item.light}>
            <span style={lightSwatch(item.light)} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
