// 像人一样动，但每次都一样：鼠标沿缓动的贝塞尔曲线走、打字间隔有抖动，全部来自带种子的随机数。
// 这里只有纯函数（不碰浏览器），test/motion.test.mjs 里有单测

// mulberry32：32 位种子的小随机数发生器，同一个种子每次给出同一串数
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    // [min, max] 之间的整数
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    next,
    // [min, max) 之间的小数
    range: (min, max) => min + (max - min) * next(),
  };
}

// 字符串 → 32 位种子（FNV-1a），镜头名、take 序号都能当种子
export function hashSeed(text) {
  let h = 0x81_1c_9d_c5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h >>> 0;
}

export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// 移动用时随距离增长（Fitts 定律的样子）：短距离约 0.2 秒，横穿整个画面约 0.8 秒（粗剪里慢吞吞的移动太多，提了速）
export function moveDurationMs(distance) {
  if (distance < 2) {
    return 0;
  }
  return Math.round(clamp(180 + 110 * Math.log2(1 + distance / 60), 200, 800));
}

// 从 from 到 to 的鼠标轨迹：两个控制点在连线两侧偏一点，走成一条微弯的弧；
// 时间上先慢后快再慢（easeInOutCubic）。每 1000/fps 毫秒一个点，最后一个点正好落在 to
export function mousePath(from, to, rng, { fps = 60 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const duration = moveDurationMs(distance);
  if (duration === 0) {
    return [{ dt: 0, x: to.x, y: to.y }];
  }
  // 连线的法向量，控制点沿它偏移，偏多少和距离成正比（最多 60px）
  const nx = -dy / distance;
  const ny = dx / distance;
  const bend = clamp(distance * rng.range(-0.12, 0.12), -60, 60);
  const p1 = {
    x: from.x + dx * 0.3 + nx * bend,
    y: from.y + dy * 0.3 + ny * bend,
  };
  const p2 = {
    x: from.x + dx * 0.75 + nx * bend * 0.6,
    y: from.y + dy * 0.75 + ny * bend * 0.6,
  };
  const frame = 1000 / fps;
  const steps = Math.max(2, Math.round(duration / frame));
  const points = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = easeInOutCubic(i / steps);
    const p = i === steps ? to : cubicBezier(from, p1, p2, to, t);
    points.push({
      dt: Math.round(frame * i),
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
    });
  }
  return points;
}

// 点哪里：框的中心附近，偏移不超过半宽/半高的 spread 倍，并且离边至少 3px
export function pointInBox(box, rng, spread = 0.2) {
  const hx = Math.max(0, box.width / 2 - 3) * spread;
  const hy = Math.max(0, box.height / 2 - 3) * spread;
  return {
    x: Math.round((box.x + box.width / 2 + rng.range(-hx, hx)) * 10) / 10,
    y: Math.round((box.y + box.height / 2 + rng.range(-hy, hy)) * 10) / 10,
  };
}

const PAUSE_AFTER = /[，。？！、；：,.?!;:]/u;

// 每个字打完后等多久：90–130ms 抖动；标点后多停一下，像人在想下一句
export function typingDelays(text, rng, { min = 90, max = 130 } = {}) {
  return [...text].map((ch) => {
    const base = Math.round(rng.range(min, max));
    return PAUSE_AFTER.test(ch) ? base + Math.round(rng.range(120, 220)) : base;
  });
}

// 平滑滚动用时：滚得越远越久，0.35–1.1 秒
export function scrollDurationMs(dy) {
  return Math.round(clamp(300 + Math.abs(dy) * 0.5, 350, 1100));
}

// 滚到哪：让元素落在滚动区域里，block=center 放正中，nearest 只滚到刚好完整露出（留 margin）
export function scrollTarget(
  { top, height, viewHeight, scrollTop, maxScroll },
  { block = "nearest", margin = 24 } = {}
) {
  // top 是元素相对滚动区域可视顶边的位置（getBoundingClientRect 差值）
  let next = scrollTop;
  if (block === "center") {
    next = scrollTop + top + height / 2 - viewHeight / 2;
  } else if (top < margin) {
    next = scrollTop + top - margin;
  } else if (top + height > viewHeight - margin) {
    // 比可视区还高：顶边对齐
    next =
      height + 2 * margin > viewHeight
        ? scrollTop + top - margin
        : scrollTop + top + height - viewHeight + margin;
  }
  return Math.round(clamp(next, 0, Math.max(0, maxScroll)));
}
