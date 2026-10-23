"use client";

import { createContext, useContext } from "react";
import type { TurnSignal } from "@/lib/learner/policy";
import type { Confidence } from "@/lib/types";

// 回答里的交互部件（检查题卡片、追问按钮、小模拟）要发消息、往输入框里放字，
// 由 ChatShell 提供，不往每层组件上传 props

export type SendBody = {
  signal?: TurnSignal;
  confidence?: Confidence;
  quizMe?: boolean;
};

type TutorActions = {
  send: (text: string, body?: SendBody) => void;
  fillInput: (text: string) => void;
  // 正在出回答，或者只读：部件都不能点
  disabled: boolean;
};

const Context = createContext<TutorActions | null>(null);

export const TutorActionsProvider = Context.Provider;

export function useTutorActions() {
  return useContext(Context);
}
