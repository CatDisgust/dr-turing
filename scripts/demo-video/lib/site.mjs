import { findPoint, lightOf } from "./checks.mjs";

// 线上站点的接口（用浏览器上下文的 request，带着 dr-student=show 这个 cookie）。
// 路由不存在时 Next.js 返回 HTML 的 404 页面，和接口自己返回的 JSON 404（比如“没有这个存档”）分得开

export class Site {
  constructor(request, base, courseId) {
    this.request = request;
    this.base = base;
    this.courseId = courseId;
  }

  async send(method, path, body) {
    const response = await this.request.fetch(`${this.base}${path}`, {
      data: body,
      failOnStatusCode: false,
      method,
      timeout: 330_000,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const status = response.status();
    return {
      error:
        json?.error ??
        (response.ok() ? null : `${status} ${text.slice(0, 160)}`),
      headers: response.headers(),
      json,
      ok: response.ok(),
      // 部署里还没有这个路由
      routeMissing: status === 404 && json === null,
      status,
    };
  }

  post(path, body = {}) {
    return this.send("POST", path, body);
  }

  get(path) {
    return this.send("GET", path);
  }

  reset() {
    return this.post("/api/demo/reset", { courseId: this.courseId });
  }

  snapshot(action, name) {
    return this.post("/api/demo/snapshot", { action, name });
  }

  // 模拟第二天：新接口把产品演示学生的全部记录往前挪 24 小时；部署里还没有它（404）才退回旧接口
  async nextDay() {
    const shift = await this.post("/api/demo/next-day-shift", {});
    if (shift.ok) {
      return { result: shift.json, used: "next-day-shift" };
    }
    if (shift.status !== 404) {
      throw new Error(`写入“第二天”失败：${shift.error}`);
    }
    const old = await this.post("/api/demo/next-day", {
      courseId: this.courseId,
      student: "show",
    });
    if (!old.ok) {
      throw new Error(`写入“第二天”失败（旧接口）：${old.error}`);
    }
    return { result: old.json, used: "next-day" };
  }

  async course() {
    const res = await this.get(`/api/course/${this.courseId}`);
    if (!res.ok) {
      throw new Error(`读课程图谱失败：${res.error}`);
    }
    return res.json.graph;
  }

  async learnerState() {
    const res = await this.get(`/api/learner/${this.courseId}`);
    if (!res.ok) {
      throw new Error(`读学生状态失败：${res.error}`);
    }
    return res.json.state;
  }

  async personalMap() {
    const res = await this.get("/api/personal/map");
    if (!res.ok) {
      throw new Error(`读我的星图失败：${res.error}`);
    }
    return res.json;
  }

  // 某个点现在多亮（按库里的 M、O 算，和页面上的算法一致）
  async light(pointId) {
    const state = await this.learnerState();
    const node = state?.nodes?.[pointId];
    return { light: lightOf(node), M: node?.M ?? 0, O: node?.O ?? 0 };
  }

  async lightCounts() {
    const state = await this.learnerState();
    const counts = { full: 0, gray: 0, half: 0 };
    for (const node of Object.values(state?.nodes ?? {})) {
      counts[lightOf(node)] += 1;
    }
    return counts;
  }

  async findPoint(re) {
    return findPoint(await this.course(), re);
  }
}
