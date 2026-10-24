// 对齐好的 take → 每个镜头的剪辑单草稿：node draft.mjs out/<take>
// 读 out/<take>/aligned.json，写 out/<take>/draft.json（post/src/edit.ts 的 ScreenShot 字段），
// 并打印每个镜头原始多长、剪完多长、哪里加速了，计时样带拿这个对讲稿

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { draftTake } from "./lib/draft.mjs";

const [, , arg] = process.argv;
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
const total = shots.reduce((n, s) => n + s.stats.edited, 0);
console.log(`合计剪后 ${total.toFixed(1)}s（分镜里录屏镜头 116s）`);
console.log(`写入 ${join(dir, "draft.json")}`);
