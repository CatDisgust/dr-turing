import { describe, expect, it } from "vitest";
import evalSet from "@/fixtures/eval/classify-comp5348.json";
import { isAccepted } from "../classify-eval";

const point = (name: string, aliases: string[] = []) => ({ aliases, name });

describe("归类评测判分", () => {
  it("名称或别名包含可接受片段就算对，大小写和标点不计", () => {
    expect(isAccepted(point("编组与解组"), ["编组"])).toBe(true);
    expect(isAccepted(point("4+1 视图模型"), ["4+1"])).toBe(true);
    expect(isAccepted(point("X", ["Lost updates"]), ["lost update"])).toBe(
      true
    );
    expect(isAccepted(point("死锁"), ["丢失更新"])).toBe(false);
    expect(isAccepted(null, ["死锁"])).toBe(false);
  });

  it("无关提问只有归为 none 才算对", () => {
    expect(isAccepted(null, null)).toBe(true);
    expect(isAccepted(point("死锁"), null)).toBe(false);
  });

  it("评测集是 20 条，其中 2 条和课无关", () => {
    expect(evalSet.items).toHaveLength(20);
    expect(evalSet.items.filter((i) => i.accept === null)).toHaveLength(2);
  });
});
