// 对齐好的 take → 每个镜头的剪辑单草稿：node draft.mjs out/<take>
// 读 out/<take>/aligned.json，写 out/<take>/draft.json（post/src/edit.ts 的 ScreenShot 字段），
// 并打印每个镜头原始多长、剪完多长、哪里加速了，计时样带拿这个对讲稿。
// 加 --clips 再逐段列出：素材时段、倍数、成片里占几秒、这段里有哪些标记（调剪辑规则用）

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { draftTake } from "./lib/draft.mjs";

const [, , arg, ...rest] = process.argv;
if (!arg) {
  console.log("用法：node draft.mjs out/<take>");
  process.exit(1);
}
const dir = resolve(arg);
const aligned = JSON.parse(readFileSync(join(dir, "aligned.json"), "utf8"));
const shots = draftTake(aligned);
writeFileSync(
  join(dir, "draft.json"),
  `${JSON.stringify({ shots, take: dir.split("/").at(-1) }, null, 1)}\n`
);
for (const s of shots) {
  const { cut, edited, raw, sped, spedOut } = s.stats;
  const fastest = Math.max(1, ...sped.map((c) => c.rate));
  console.log(
    `镜头 ${s.shot}：原始 ${raw.toFixed(1)}s → 剪后 ${edited.toFixed(1)}s${cut > 0 ? `，剪掉 ${cut.toFixed(1)}s` : ""}；加速 ${sped.length} 段共 ${spedOut.toFixed(1)}s（最快 ×${fastest}）；镜头键 ${s.camera.length} 个，点击 ${s.clicks.length} 次`
  );
}
if (rest.includes("--clips")) {
  const marks = aligned.marks ?? [];
  for (const s of shots) {
    console.log(`\n== 镜头 ${s.shot}`);
    for (const c of s.clips) {
      const out = (c.to - c.from) / (c.rate ?? 1);
      const inside = marks
        .filter((m) => m.t >= c.from - 0.01 && m.t < c.to)
        .map(
          (m) =>
            `${m.name.replace("wait.reply.", "等:")}${m.label ? `(${m.label})` : ""}`
        )
        .join("，");
      console.log(
        `${c.from.toFixed(2)}–${c.to.toFixed(2)} ${c.rate ? `×${c.rate}` : "原速"} 成片 ${out.toFixed(2)}s  ${inside}`
      );
    }
  }
  console.log("");
}
const total = shots.reduce((n, s) => n + s.stats.edited, 0);
console.log(`合计剪后 ${total.toFixed(1)}s（分镜里录屏镜头 116s）`);
console.log(`写入 ${join(dir, "draft.json")}`);
