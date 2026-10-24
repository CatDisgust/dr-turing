// 把一条录好的 take 接进后期工程：node scripts/use-take.mjs ../out/<take> [--no-footage]
// 读 <take>/draft.json（先跑 align.mjs 和 draft.mjs），写 src/data/take.json；
// 素材 screen.mov 复制到 public/takes/<take>.mov（--no-footage 时不复制，用占位画面）。
// 再打印计时表：每个镜头剪完的画面多长、讲稿念完要多久、分镜给了多少秒

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT } from "../src/data/script.ts";
import { autoCues } from "../src/timing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--"));
if (!dirArg) {
  console.log("用法：node scripts/use-take.mjs ../out/<take> [--no-footage]");
  process.exit(1);
}
const dir = resolve(dirArg);
const take = basename(dir);
const draft = JSON.parse(readFileSync(join(dir, "draft.json"), "utf8"));

let footage = null;
const source = join(dir, "screen.mov");
if (!args.includes("--no-footage") && existsSync(source)) {
  footage = `takes/${take}.mov`;
  mkdirSync(join(root, "public/takes"), { recursive: true });
  copyFileSync(source, join(root, "public", footage));
}

writeFileSync(
  join(root, "src/data/take.json"),
  `${JSON.stringify({ footage, shots: draft.shots, take }, null, 1)}\n`
);

const rows = [];
let total = 0;
for (const shot of draft.shots.filter((s) => s.shot >= 3 && s.shot <= 7)) {
  const s = SCRIPT.find((x) => x.id === `s${shot.shot}`);
  const voice = autoCues(s.narration, shot.shot === 3 ? 1.9 : 0.5).end + 0.6;
  const length = Math.max(shot.stats.edited, voice);
  total += length;
  rows.push(
    `| 镜头 ${shot.shot} | ${shot.stats.raw.toFixed(1)} | ${shot.stats.edited.toFixed(1)} | ${voice.toFixed(1)} | ${s.slot} | ${length.toFixed(1)} |`
  );
}
const table = [
  `# 计时表（${take}）`,
  "",
  "单位秒。剪后画面 = 思考和复核等待加速、导师出字加速、剪掉“先不做题”和重开页面之后；讲稿 = 按每秒 4.2 字估的念完时间；成片取两者较长的。",
  "",
  "| 镜头 | 原始 | 剪后画面 | 讲稿 | 分镜 | 成片 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `录屏镜头合计 ${total.toFixed(1)} 秒（分镜 116 秒）。`,
].join("\n");
writeFileSync(join(dir, "timing.md"), `${table}\n`);
console.log(table);
console.log(
  `\n写入 src/data/take.json${footage ? `，素材复制到 public/${footage}` : "（没有素材，用占位画面）"}；预览：npm run studio，合成名 Take`
);
