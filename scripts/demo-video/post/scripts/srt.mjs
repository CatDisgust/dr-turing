// 导出 SRT 字幕文件（和烧录字幕同一份时间）：node scripts/srt.mjs [Take|Animatic] [输出路径]
// 默认 Take，写 out/Take.srt。src/data 里的 .ts 要用 esbuild 打包一下才能在 node 里跑（有 json 导入）

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "Take";
const file = resolve(process.argv[3] ?? join(root, "out", `${name}.srt`));

const bundled = await build({
  bundle: true,
  format: "esm",
  platform: "node",
  stdin: {
    contents: [
      'export { animatic } from "./src/data/animatic";',
      'export { fromTake } from "./src/data/take";',
      'export { shotDuration, subtitleText } from "./src/edit";',
    ].join("\n"),
    loader: "ts",
    resolveDir: root,
  },
  write: false,
});
const { animatic, fromTake, shotDuration, subtitleText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const edit = name === "Animatic" ? animatic : fromTake;
if (!edit) {
  console.error(`没有 ${name}：先跑 use-take.mjs`);
  process.exit(1);
}

const stamp = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const lines = [];
let start = 0;
for (const shot of edit.shots) {
  const end = start + shotDuration(shot);
  for (const cue of shot.cues) {
    // 镜头切走时字幕也跟着没了
    const a = start + cue.start;
    const b = Math.min(start + cue.end, end);
    if (b > a) {
      lines.push(
        `${lines.length + 1}\n${stamp(a)} --> ${stamp(b)}\n${subtitleText(cue.text)}\n`
      );
    }
  }
  start = end;
}
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, lines.join("\n"));
console.log(`${lines.length} 条字幕，${stamp(start)}；写入 ${file}`);
