import { describe, expect, it } from "vitest";
import { gate, makeCode, normalizeCode } from "../access";

describe("gate", () => {
  it("没设管理员码时一切照旧", () => {
    expect(gate("/", undefined, undefined)).toBe("pass");
    expect(gate("/compare", undefined, undefined)).toBe("pass");
  });

  it("没码的人只能进登录页", () => {
    expect(gate("/", undefined, "boss")).toBe("login");
    expect(gate("/api/chat", undefined, "boss")).toBe("login");
    expect(gate("/login", undefined, "boss")).toBe("pass");
    expect(gate("/api/login", undefined, "boss")).toBe("pass");
  });

  it("邀请码能学，但进不了管理员的页面", () => {
    expect(gate("/", "ming-abc", "boss")).toBe("pass");
    expect(gate("/api/chat", "ming-abc", "boss")).toBe("pass");
    expect(gate("/api/course/comp5348", "ming-abc", "boss")).toBe("pass");
    expect(gate("/admin", "ming-abc", "boss")).toBe("forbidden");
    expect(gate("/api/demo/seed", "ming-abc", "boss")).toBe("forbidden");
    expect(gate("/course/comp5348", "ming-abc", "boss")).toBe("forbidden");
    expect(gate("/compare", "ming-abc", "boss")).toBe("forbidden");
  });

  it("前缀只按整段路径算", () => {
    expect(gate("/administer", "ming-abc", "boss")).toBe("pass");
    expect(gate("/api/courses", "ming-abc", "boss")).toBe("pass");
  });

  it("管理员哪都能进", () => {
    expect(gate("/admin", "boss", "boss")).toBe("pass");
    expect(gate("/api/demo/reset", "boss", "boss")).toBe("pass");
  });
});

describe("邀请码", () => {
  it("名字转成前缀，后面 6 位随机", () => {
    let i = 0;
    const seq = () => {
      i += 1;
      return [0, 0.5, 0.99, 0.1, 0.2, 0.3][i % 6];
    };
    expect(makeCode("Ming Li", seq)).toMatch(/^mingli-[a-z2-9]{6}$/);
  });

  it("中文名没有前缀，只有随机部分", () => {
    expect(makeCode("小明")).toMatch(/^[a-z2-9]{6}$/);
  });

  it("输入时忽略大小写和空格", () => {
    expect(normalizeCode("  Ming-ABC ")).toBe("ming-abc");
  });
});
