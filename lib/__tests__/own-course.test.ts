import { describe, expect, it } from "vitest";
import {
  canSeeCourse,
  fileBlock,
  OWN_LIMITS,
  uploadBlock,
} from "../own-course";

const ok = {
  budgetCents: 500,
  courseLimit: 2,
  generations: 0,
  own: 0,
  spentMicroUsd: 0,
};

describe("学生自己传课", () => {
  it("公开课大家能看，私人课只有自己能看", () => {
    expect(canSeeCourse({ ownerId: null }, "u1")).toBe(true);
    expect(canSeeCourse({ ownerId: "u1" }, "u1")).toBe(true);
    expect(canSeeCourse({ ownerId: "u1" }, "u2")).toBe(false);
  });

  it("额度、课数、生成次数，哪个到了就挡住并说清楚", () => {
    expect(uploadBlock(ok)).toBeNull();
    expect(uploadBlock({ ...ok, spentMicroUsd: 5_000_000 })).toContain(
      "额度用完"
    );
    expect(uploadBlock({ ...ok, own: 2 })).toContain("最多 2 门");
    expect(
      uploadBlock({ ...ok, generations: OWN_LIMITS.generations })
    ).toContain("已经用完");
  });

  it("文件太大、页数太多不收", () => {
    expect(fileBlock(1024)).toBeNull();
    expect(fileBlock(21 * 1024 * 1024)).toContain("20MB");
    expect(fileBlock(1024, 81)).toContain("81 页");
    expect(fileBlock(1024, 80)).toBeNull();
  });
});
