import type { LearnerState } from "@/lib/types";

// 这一次学习的投入度：记的是别的会话（或旧数据没记会话）就从零算。
// 以前只在独立答对后清零，累计到门槛后规则①每轮都只给提示，学生没机会答对，永远出不来（建模审查第 1 条）
export function sessionEngagement(
  engagement: LearnerState["engagement"],
  sessionId: string
): LearnerState["engagement"] {
  return engagement.sessionId === sessionId
    ? engagement
    : { giveUps: 0, justTellMe: 0, sessionId, skippedQuestions: 0 };
}
