// 音效：自己合成，不用外部素材（没有版权问题）。use-take.mjs 调用，写 public/sfx/*.wav：
//   click.wav       轻轻一下鼠标点击
//   chime-half.wav  「死锁」半亮：两个音，柔和
//   chime-full.wav  「死锁」全亮：三个音往上走，亮一些、尾音长一些
// 也可以单独跑：node scripts/sfx.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48_000;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries()) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32_767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

function normalize(samples, peak) {
  const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
  return samples.map((s) => (s / max) * peak);
}

// 固定种子的噪声，每次生成的文件一样
function noise(seed = 7) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 1_073_741_824 - 1;
  };
}

export function click() {
  const n = Math.round(RATE * 0.07);
  const rand = noise();
  const out = new Float64Array(n);
  let low = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    // 一小下带通噪声（指甲敲桌面那种“嗒”）+ 很轻的低音，几毫秒内衰减
    low += 0.35 * (rand() - low);
    const tick =
      (Math.sin(2 * Math.PI * 2600 * t) * 0.6 + low * 0.5) *
      Math.exp(-t / 0.0035);
    const body = Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-t / 0.012);
    out[i] = tick + body;
  }
  return normalize(Array.from(out), 0.5);
}

// 钢片琴一样的音：基音加几个泛音，泛音衰减得快；起音 4 毫秒免得爆音
function bell(out, start, freq, decay, gain) {
  const partials = [
    [1, 1],
    [2, 0.32],
    [3.01, 0.12],
    [4.18, 0.06],
  ];
  const from = Math.round(start * RATE);
  for (let i = from; i < out.length; i += 1) {
    const t = (i - from) / RATE;
    const attack = Math.min(1, t / 0.004);
    let s = 0;
    for (const [k, a] of partials) {
      s +=
        a * Math.sin(2 * Math.PI * freq * k * t) * Math.exp(-t / (decay / k));
    }
    out[i] += s * attack * gain;
  }
}

export function chime(notes, decay, length) {
  const out = new Float64Array(Math.round(RATE * length));
  for (const [i, f] of notes.entries()) {
    bell(out, i * 0.09, f, decay, 1 - i * 0.12);
  }
  // 尾巴最后 0.15 秒淡出
  const fade = Math.round(RATE * 0.15);
  for (let i = out.length - fade; i < out.length; i += 1) {
    out[i] *= (out.length - i) / fade;
  }
  return normalize(Array.from(out), 0.45);
}

export function makeSfx(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "click.wav"), wav(click()));
  // E5、B5；全亮 E5、G#5、B5、E6
  writeFileSync(
    join(dir, "chime-half.wav"),
    wav(chime([659.3, 987.8], 0.7, 1.4))
  );
  writeFileSync(
    join(dir, "chime-full.wav"),
    wav(chime([659.3, 830.6, 987.8, 1318.5], 1.1, 2.2))
  );
  return ["click.wav", "chime-half.wav", "chime-full.wav"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "public/sfx");
  console.log(`写入 ${dir}：${makeSfx(dir).join("、")}`);
}
