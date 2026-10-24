import { describe, expect, it } from "vitest";
import { makeCourseId } from "../course-id";

describe("makeCourseId", () => {
  it("课名的字母数字做前缀，后面接 4 位随机", () => {
    expect(makeCourseId("COMP5349 Cloud Computing", () => 0)).toBe(
      "comp5349cl-aaaa"
    );
  });

  it("全是中文时用 course 做前缀", () => {
    expect(makeCourseId("操作系统", () => 0)).toBe("course-aaaa");
  });

  it("每次生成都不一样", () => {
    expect(makeCourseId("os")).not.toBe(makeCourseId("os"));
  });
});
