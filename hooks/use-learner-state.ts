"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COURSE_ID,
  GRADED_EVENT,
  LEARNER_REFRESH_EVENT,
  NODE_TOUCHED_EVENT,
} from "@/lib/constants";
import type { LearnerState } from "@/lib/types";

// 当前学生的状态：归类、批改、一轮结束时都从库里重新取
export function useLearnerState() {
  const [state, setState] = useState<LearnerState | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/learner/${COURSE_ID}`)
      .then((response) => response.json())
      .then((body) => setState(body.state))
      .catch(() => {
        /* 刷新失败就保持上一份 */
      });
  }, []);

  useEffect(() => {
    refresh();
    const events = [NODE_TOUCHED_EVENT, GRADED_EVENT, LEARNER_REFRESH_EVENT];
    for (const name of events) {
      window.addEventListener(name, refresh);
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, refresh);
      }
    };
  }, [refresh]);

  return state;
}
