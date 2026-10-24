// 网页内容在 OBS 素材里的位置 → OBS 场景项的裁剪和缩放，让 2560×1440 画布正好是网页的 1280×720（Retina 2 倍）。
// 纯函数，test/geometry.test.mjs 有单测

export const VIEW = { height: 720, width: 1280 };
export const CANVAS = { height: 1440, width: 2560 };

// box：网页内容在采集源画面里的框（源像素）。返回 SetSceneItemTransform 要的裁剪和缩放
export function cropFromBox(box, source, canvas = CANVAS) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.width);
  const h = Math.round(box.height);
  const crop = {
    cropBottom: source.height - y - h,
    cropLeft: x,
    cropRight: source.width - x - w,
    cropTop: y,
  };
  const ok =
    w > 0 &&
    h > 0 &&
    Object.values(crop).every((v) => Number.isFinite(v) && v >= 0);
  return {
    ...crop,
    ok,
    scaleX: canvas.width / w,
    scaleY: canvas.height / h,
  };
}

// 没法用品红框校准时，按窗口几何推算：
// window 模式（采集整个窗口）：内容在窗口里偏 (contentLeft, contentTop) 点；
// display 模式（采集整块屏幕）：再加上窗口在屏幕上的位置。点 → 像素按“源宽 / 窗口或屏幕宽”算
export function boxFromGeometry(
  source,
  { mode, outer, contentLeft, contentTop, screen, view = VIEW }
) {
  const s =
    mode === "display"
      ? source.width / screen.width
      : source.width / outer.width;
  const left = mode === "display" ? outer.left + contentLeft : contentLeft;
  const top = mode === "display" ? outer.top + contentTop : contentTop;
  return {
    height: view.height * s,
    scale: s,
    width: view.width * s,
    x: left * s,
    y: top * s,
  };
}

// 品红框量出来的框是否和预期差不多（大小误差 3% 以内）
export function plausibleBox(box, expected) {
  if (!box) {
    return false;
  }
  const close = (a, b) => Math.abs(a - b) <= b * 0.03;
  return close(box.width, expected.width) && close(box.height, expected.height);
}
