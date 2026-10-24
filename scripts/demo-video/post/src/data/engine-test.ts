import type { Edit } from "../edit";

// 引擎自检：合成的测试素材（2700×1600，网页区域在 70,120，Retina 2 倍），
// 红点在网页坐标 (1000, 600)。放大、光标、点击波纹都应该正好落在红点上
export const engineTest: Edit = {
  fps: 60,
  height: 1080,
  shots: [
    {
      badges: [{ text: "演示账号 · 学习记录为预置" }],
      camera: [
        { t: 1, x: 1000, y: 600, zoom: 2 },
        { t: 3.2, x: 640, y: 360, zoom: 1 },
      ],
      clicks: [{ t: 1.6, x: 1000, y: 600 }],
      clips: [
        { from: 0, to: 4 },
        { from: 4, rate: 3, to: 10 },
        { from: 10, to: 12 },
      ],
      cues: [
        { end: 2.5, start: 0.3, text: "镜头放大到红点，光标点下去" },
        {
          end: 6.5,
          position: "top",
          start: 4.2,
          text: "这一段加速了，字幕在上面",
        },
      ],
      cursor: [
        { t: 0.4, x: 200, y: 200 },
        { t: 1.5, x: 1000, y: 600 },
      ],
      footage: "test/footage.mp4",
      id: "engine",
      kind: "screen",
      title: "引擎自检",
      viewport: { height: 1600, scale: 2, width: 2700, x: 70, y: 120 },
    },
  ],
  width: 1920,
};
