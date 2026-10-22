import type { NodeState } from "@/lib/types";
import { FULL_O, HALF_M } from "./config";

// 节点亮度，每次从状态重算，不单独存：
// 全亮 O ≥ 0.7；半亮 M ≥ 0.6；本次会话涉及过但还没到半亮是虚线亮；其余灰
export type Light = "gray" | "dashed" | "half" | "full";

export type NodeLight = {
  light: Light;
  provisional: boolean; // 用到了快路径的暂定证据，复核后转正或退回
  ring: number; // O 进度环 0–1：O / 全亮门槛
};

export function nodeLight(
  node: NodeState | undefined,
  sessionId?: string
): NodeLight {
  if (!node) {
    return { light: "gray", provisional: false, ring: 0 };
  }
  let light: Light = "gray";
  if (node.O >= FULL_O) {
    light = "full";
  } else if (node.M >= HALF_M) {
    light = "half";
  } else if (sessionId !== undefined && node.touchedInSession === sessionId) {
    light = "dashed";
  }
  return {
    light,
    provisional: node.attempts.some((a) => a.provisional),
    ring: Math.min(1, node.O / FULL_O),
  };
}
