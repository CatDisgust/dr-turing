import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/700.css";
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

// 配色照整站视觉规范「D 冷灰加蓝」+ 星图抽屉的天文馆黑
export const C = {
  blue: "#0071A5",
  blueEdge: "#84D8FF",
  blueSoft: "#DDF4FF",
  border: "#DEE3EC",
  bubble: "#EFF3F9",
  green: "#58CC02",
  greenEdge: "#46A302",
  ink: "#252E3C",
  inkSoft: "#566172",
  page: "#FFFFFF",
  red: "#FF4B4B",
  redEdge: "#D42A2A",
  sky: "#05070B",
  // 星星：看懂了半亮（暖黄、暗）、真会了全亮（白、有光芒）
  starFull: "#FFF4E0",
  starHalf: "#C9A45C",
  textOnSky: "#F2F5FA",
  textOnSkySoft: "#8A93A0",
};

export const FONT = '"Noto Sans SC", "PingFang SC", sans-serif';

// 中文字体按需分片加载：渲染前把这一镜要用到的字先加载好，避免前几帧是后备字体
export function useFonts(text: string) {
  const [handle] = useState(() => delayRender("加载中文字体"));
  useEffect(() => {
    const sample = text || "Dr.Turing";
    Promise.all([
      document.fonts.load(`400 40px "Noto Sans SC"`, sample),
      document.fonts.load(`700 40px "Noto Sans SC"`, sample),
    ])
      .then(() => continueRender(handle))
      .catch((error) => cancelRender(error));
  }, [handle, text]);
}
