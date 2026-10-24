import { execFileSync } from "node:child_process";

// 找录屏用的那个 Chrome 窗口的 CGWindowID，交给 OBS 的“窗口采集”。
// OBS 通过 websocket 拿不到窗口列表（列表只在属性面板里现建），所以在本机用 JXA 调
// CGWindowListCopyWindowInfo：窗口号、所属进程、位置大小不需要屏幕录制权限，按“进程号 + 位置大小”认

const JXA = `
ObjC.import('CoreGraphics');
const raw = $.CGWindowListCopyWindowInfo(1 | 16, 0);
const list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || [];
JSON.stringify(list.map((w) => ({
  bounds: w.kCGWindowBounds,
  id: w.kCGWindowNumber,
  layer: w.kCGWindowLayer,
  name: w.kCGWindowName || '',
  owner: w.kCGWindowOwnerName || '',
  pid: w.kCGWindowOwnerPID,
})));
`;

export function listWindows() {
  const out = execFileSync("osascript", ["-l", "JavaScript", "-e", JXA], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return JSON.parse(out.trim() || "[]");
}

// 纯函数：在窗口列表里挑出位置大小最接近 bounds 的那个（同进程优先，退而求其次认名字里有 Chrome 的）
export function pickWindow(windows, { pid, bounds, tolerance = 8 }) {
  const distance = (w) =>
    Math.abs((w.bounds?.X ?? 0) - bounds.left) +
    Math.abs((w.bounds?.Y ?? 0) - bounds.top) +
    Math.abs((w.bounds?.Width ?? 0) - bounds.width) +
    Math.abs((w.bounds?.Height ?? 0) - bounds.height);
  const normal = windows.filter((w) => (w.layer ?? 0) === 0);
  const pools = [
    normal.filter((w) => pid && w.pid === pid),
    normal.filter((w) => /chrom/i.test(w.owner ?? "")),
  ];
  for (const pool of pools) {
    const [best] = pool
      .map((w) => ({ d: distance(w), w }))
      .toSorted((a, b) => a.d - b.d);
    if (best && best.d <= tolerance * 4) {
      return best.w;
    }
  }
  return null;
}
