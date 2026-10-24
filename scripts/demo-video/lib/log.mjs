import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 一条（take）的日志：页面事件和脚本标记放在同一条时间线上（毫秒时间戳），录完写成 out/<take>/log.json。
// 导师每条回复的原文另外追加到 tutor-text.md，给人核对事实

export class TakeLog {
  constructor({ dir, meta }) {
    this.dir = dir;
    this.meta = meta;
    this.events = [];
    this.t0 = Date.now();
    this.tutorPath = join(dir, "tutor-text.md");
    writeFileSync(
      this.tutorPath,
      `# 导师回复原文（${meta.take}）\n\n站点：${meta.site}\n\n逐条核对事实；“你”是脚本替学生打的字。\n`
    );
  }

  rel(t = Date.now()) {
    return `${((t - this.t0) / 1000).toFixed(1).padStart(6)}s`;
  }

  addPage(batch) {
    for (const e of batch) {
      this.events.push(e);
    }
  }

  mark(name, data = {}) {
    const e = { name, src: "script", t: Date.now(), type: "mark", ...data };
    this.events.push(e);
    const detail =
      Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
    console.log(
      `[${this.meta.take} ${this.rel(e.t)}] ${name}${detail.slice(0, 300)}`
    );
    return e;
  }

  warn(message, data = {}) {
    this.mark("warn", { message, ...data });
  }

  // 等待开始、结束各记一笔，后期按这两个标记把等待剪掉或加速
  wait(name) {
    const start = Date.now();
    this.mark(`wait.${name}.start`);
    return (extra = {}) =>
      this.mark(`wait.${name}.end`, { ms: Date.now() - start, ...extra });
  }

  tutor(heading, text) {
    appendFileSync(this.tutorPath, `\n## ${heading}\n\n${text.trim()}\n`);
  }

  // 某个时刻之后、某种页面事件里最后一条
  lastEvent(test, since = 0) {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i];
      if (e.t >= since && test(e)) {
        return e;
      }
    }
    return null;
  }

  save(extra = {}) {
    const events = this.events.toSorted((a, b) => a.t - b.t);
    writeFileSync(
      join(this.dir, "log.json"),
      `${JSON.stringify({ ...this.meta, ...extra, events }, null, 1)}\n`
    );
  }
}
