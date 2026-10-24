// 背景音乐：自己合成，不用外部素材（没有版权问题）。use-take.mjs 调用，写 public/music/bed.wav、lift.wav：
//   温暖的铺底（E 大调，100 拍），软垫和弦 + 低音 + 稀疏的钢片琴分解和弦，加混响；开头 12 秒只有软垫。
//   lift 是对齐的抬起层，「死锁」全亮时淡入到结尾。比成片长一些，成片结尾由 video.tsx MusicTrack 淡出，说话时自动压低
// 也可以单独跑：node scripts/music.mjs [秒数]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48_000;
const BEAT = 0.6; // 100 拍
const BAR = BEAT * 4;
const CHORD = BAR * 2; // 每个和弦两小节，4.8 秒

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// 和弦：低音、软垫、分解和弦用的音（MIDI 音高）
const CHORDS = {
  A: { arp: [61, 64, 68, 71, 73], bass: 33, pad: [52, 56, 59, 61] }, // Amaj9
  B: { arp: [59, 64, 66, 69, 71], bass: 35, pad: [54, 57, 59, 64] }, // B11
  C: { arp: [61, 64, 68, 71, 75], bass: 37, pad: [52, 56, 59, 63] }, // C#m9
  E: { arp: [64, 68, 71, 75, 78], bass: 40, pad: [52, 59, 63, 66, 68] }, // Emaj9
  G: { arp: [63, 66, 68, 71, 75], bass: 44, pad: [51, 56, 59, 66] }, // G#m7
};
// 主段 E C A B，副段 A B G C；排成 主 主 副 主 副 主 主 …
const VERSE = ["E", "C", "A", "B"];
const BRIDGE = ["A", "B", "G", "C"];
const FORM = [VERSE, VERSE, BRIDGE, VERSE, BRIDGE, VERSE, VERSE, VERSE];

// 两小节的分解和弦节奏：八分音符位置 → 和弦里第几个音（null 休止）、力度
const ARP = [
  [0, 0.9],
  null,
  [2, 0.6],
  null,
  [1, 0.7],
  [3, 0.5],
  null,
  [2, 0.55],
  [0, 0.8],
  null,
  [2, 0.55],
  null,
  [4, 0.65],
  null,
  [3, 0.5],
  null,
];

// 固定种子的随机数，每次生成的文件一样
function random(seed = 11) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  };
}

// 带限锯齿波表（只到第 10 个泛音，免得刺耳）
const TABLE = 4096;
const SAW = new Float32Array(TABLE);
for (let i = 0; i < TABLE; i += 1) {
  for (let k = 1; k <= 10; k += 1) {
    SAW[i] += Math.sin((2 * Math.PI * k * i) / TABLE) / k;
  }
}

function env(t, length, attack, release) {
  if (t < attack) {
    return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  }
  if (t > length - release) {
    return Math.max(
      0,
      0.5 + 0.5 * Math.cos((Math.PI * (t - length + release)) / release)
    );
  }
  return 1;
}

// 软垫：每个音三个略微走调的锯齿，左右分开
function pad(L, R, start, length, midi, gain) {
  const voices = [
    [-7, 0.85, 0.3],
    [0, 0.6, 0.6],
    [7, 0.3, 0.85],
  ];
  const from = Math.round(start * RATE);
  const n = Math.round(length * RATE);
  for (const [cents, l, r] of voices) {
    const step = (hz(midi) * 2 ** (cents / 1200) * TABLE) / RATE;
    let phase = (cents + 100) * 13.7;
    for (let i = 0; i < n && from + i < L.length; i += 1) {
      const s =
        SAW[Math.floor(phase) % TABLE] * env(i / RATE, length, 2.2, 2.6) * gain;
      L[from + i] += s * l;
      R[from + i] += s * r;
      phase += step;
    }
  }
}

// 低音：正弦加一点二次泛音
function bass(out, start, length, midi, gain) {
  const from = Math.round(start * RATE);
  const n = Math.round(length * RATE);
  const w = 2 * Math.PI * hz(midi);
  for (let i = 0; i < n && from + i < out.length; i += 1) {
    const t = i / RATE;
    out[from + i] +=
      (Math.sin(w * t) + 0.35 * Math.sin(2 * w * t)) *
      env(t, length, 0.4, 1.5) *
      gain;
  }
}

// 钢片琴：基音 + 泛音，泛音衰减更快；起音 3 毫秒免得爆音
function pluck(L, R, start, midi, gain, pan) {
  const from = Math.round(start * RATE);
  const n = Math.round(2.5 * RATE);
  const f = hz(midi);
  const partials = [
    [1, 1, 1.1],
    [2, 0.25, 0.45],
    [3, 0.08, 0.25],
    [4.2, 0.03, 0.12],
  ];
  for (let i = 0; i < n && from + i < L.length; i += 1) {
    const t = i / RATE;
    let s = 0;
    for (const [k, a, d] of partials) {
      s += a * Math.sin(2 * Math.PI * f * k * t) * Math.exp(-t / d);
    }
    s *= Math.min(1, t / 0.003) * gain;
    L[from + i] += s * (1 - pan);
    R[from + i] += s * pan;
  }
}

// 两极低通，软垫不刺耳、也给讲话的频段让出位置
function lowpass(x, cutoff) {
  const g = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let a = 0;
  let b = 0;
  for (let i = 0; i < x.length; i += 1) {
    a += g * (x[i] - a);
    b += g * (a - b);
    x[i] = b;
  }
}

// Freeverb：8 个梳状 + 4 个全通，右声道错开一点
function reverb(input, spread) {
  const scale = RATE / 44_100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({
    buf: new Float32Array(Math.round((d + spread) * scale)),
    i: 0,
    store: 0,
  }));
  const passes = [556, 441, 341, 225].map((d) => ({
    buf: new Float32Array(Math.round((d + spread) * scale)),
    i: 0,
  }));
  const feedback = 0.9;
  const damp = 0.3;
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n += 1) {
    const x = input[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const p of passes) {
      const o = p.buf[p.i];
      p.buf[p.i] = y + o * 0.5;
      p.i = (p.i + 1) % p.buf.length;
      y = o - y;
    }
    out[n] = y;
  }
  return out;
}

// 一层的合成：软垫、低音、钢片琴进混响，再混成立体声
function mix({ padL, padR, keyL, keyR, low }, n, seconds) {
  lowpass(padL, 1400);
  lowpass(padR, 1400);
  const mono = Float32Array.from(
    { length: n },
    (_, i) => (padL[i] + padR[i]) * 0.5 + (keyL[i] + keyR[i]) * 0.9
  );
  const wetL = reverb(mono, 0);
  const wetR = reverb(mono, 23);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const fade = Math.min(1, t / 3, (seconds - t) / 6);
    L[i] = (padL[i] + keyL[i] * 0.8 + low[i] + wetL[i] * 0.55) * fade;
    R[i] = (padR[i] + keyR[i] * 0.8 + low[i] + wetR[i] * 0.55) * fade;
  }
  return [L, R];
}

const layer = (n) => ({
  keyL: new Float32Array(n),
  keyR: new Float32Array(n),
  low: new Float32Array(n),
  padL: new Float32Array(n),
  padR: new Float32Array(n),
});

// 两层，拍子和和弦完全对齐：
//   bed  整段铺底：软垫 + 低音 + 分解和弦（开头 12 秒只有软垫）
//   lift 抬起层：高八度的分解和弦、每拍一下轻低音、软垫加一个高音；成片在「死锁」全亮时淡入，一直到结尾
// 两层用同一个增益，渲染时 lift 音量给 1 就是设计好的比例
export function bed(seconds = 200) {
  const n = Math.round(seconds * RATE);
  const base = layer(n);
  const up = layer(n);
  const rand = random();
  const chords = FORM.flat();
  for (let c = 0; c * CHORD < seconds; c += 1) {
    const chord = CHORDS[chords[c % chords.length]];
    const start = c * CHORD;
    for (const m of chord.pad) {
      pad(base.padL, base.padR, start, CHORD + 2.4, m, 0.05);
    }
    pad(up.padL, up.padR, start, CHORD + 2.4, chord.pad.at(-1) + 12, 0.035);
    bass(base.low, start, CHORD + 1.2, chord.bass, 0.05);
    for (let b = 0; b < 8; b += 1) {
      bass(up.low, start + b * BEAT, 0.45, chord.bass + 12, 0.05);
    }
    for (const [i, hit] of ARP.entries()) {
      const t = start + i * (BEAT / 2) + (rand() - 0.5) * 0.012;
      if (hit && start >= 12) {
        const [k, v] = hit;
        const g = v * (0.85 + rand() * 0.15) * 0.26;
        pluck(base.keyL, base.keyR, t, chord.arp[k], g, 0.35 + rand() * 0.3);
      }
      // 抬起层把休止的位置补上，高八度
      if (!hit) {
        const k = (i * 3) % chord.arp.length;
        pluck(up.keyL, up.keyR, t, chord.arp[k] + 12, 0.15, 0.2 + rand() * 0.6);
      }
    }
  }
  const outBed = mix(base, n, seconds);
  const outLift = mix(up, n, seconds);
  const peak = Math.max(
    ...[...outBed, ...outLift].map((x) =>
      x.reduce((m, s) => Math.max(m, Math.abs(s)), 0)
    )
  );
  // 两层叠起来也不削波
  const g = 0.7 / (peak * 1.6 || 1);
  const scale = ([L, R]) => [L.map((x) => x * g), R.map((x) => x * g)];
  return { bed: scale(outBed), lift: scale(outLift) };
}

function wav([L, R]) {
  const data = Buffer.alloc(L.length * 4);
  for (let i = 0; i < L.length; i += 1) {
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, L[i])) * 32_767),
      i * 4
    );
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, R[i])) * 32_767),
      i * 4 + 2
    );
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function makeMusic(dir, seconds = 200) {
  mkdirSync(dir, { recursive: true });
  const layers = bed(seconds);
  writeFileSync(join(dir, "bed.wav"), wav(layers.bed));
  writeFileSync(join(dir, "lift.wav"), wav(layers.lift));
  return ["bed.wav", "lift.wav"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "public/music");
  const seconds = Number(process.argv[2] ?? 200);
  console.log(
    `写入 ${dir}：${makeMusic(dir, seconds).join("、")}（${seconds} 秒）`
  );
}
