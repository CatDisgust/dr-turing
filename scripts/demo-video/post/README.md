# 演示视频后期（Remotion）

录屏素材、字卡、字幕、配音、音乐和音效在这里合成成片。制作方案见 https://claude.ai/artifact/TvWLDVUxVS9LCQJYfzZ6JB ，分镜和讲稿见 https://claude.ai/artifact/82S8WU6PnK6W3b12Ttkkq2 。

## 结构

- `src/edit.ts`：剪辑单格式，加上时间换算、镜头放大、光标插值、字幕检查。都是纯函数。
- `src/data/script.ts`：讲稿，从分镜文档逐字抄过来。
- `src/data/animatic.ts`：计时样带。字卡是真的，录屏镜头先用占位画面，字幕按语速估时间。
- `src/data/engine-test.ts`：引擎自检。用合成的测试素材检查放大、光标、加速、字幕的位置对不对。
- `src/components/`：
  - `cards.tsx`：字卡，镜头 1、2、试点计划、收尾。
  - `screen.tsx`：录屏镜头，包括取片段、加速、放大平移、光标、点击波纹、角标和标题卡。
  - `overlays.tsx`：字幕、角标、光标。
  - `sky.tsx`：夜空背景和星星。
- `src/video.tsx`：把镜头按顺序排起来，配音、音效和音乐（说话时自动压低）都在这里接上。

## 用法

```bash
cd scripts/demo-video/post
npm install
npm run studio            # 浏览器里预览，可以拖时间轴
npx remotion render src/index.ts Animatic out/animatic.mp4
npx remotion still src/index.ts EngineTest out/engine.png --frame=108
```

云端沙盒里没法下载 Chrome，要先设 `REMOTION_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`。在 Mac 上不用设。

素材、配音、音乐都放在 `public/` 下。这些是大文件，不进仓库。

## 用真实录制做计时样带

在 `scripts/demo-video` 里录完一条后：

```bash
node align.mjs out/<take>      # 对时间，写 aligned.json
node draft.mjs out/<take>      # 剪辑单草稿，写 draft.json
cd post
node scripts/use-take.mjs ../out/<take>   # 接进后期工程，复制素材，打印计时表（也写进 <take>/timing.md）
npx remotion render src/index.ts Take out/take.mp4
```

剪辑单草稿的规则（`lib/draft.mjs` 开头有完整说明）：导师思考和复核等待压到 0.8 秒以内；导师出字压到 2 秒以内；打字压到 2.2 秒以内；画面什么都没动超过 1.2 秒就快放；鼠标停留原速但最多 2 秒（题目 2.4 秒、出处 3 秒、镜头 3 的星图全留）；反例追问、“先不做题”、第二道起的独立题整轮快放；镜头 7 开头的模拟第二天和第二次小结剪掉。镜头放大跟着鼠标停留走：打字和点模拟器 1.4 倍，小字标签、判分、星星 2 倍。所有加速段右上角标「已加速 ×N」。讲稿比画面长的镜头，先放慢加速段，还不够才在最后一帧停住补够。

### 临时配音

```bash
node scripts/temp-voice.mjs          # Mac 自带普通话声音念讲稿，写 public/voice/*.wav 和 src/data/voice.json
node scripts/use-take.mjs ../out/<take>   # 计时表改用配音的实际时长
npx remotion render src/index.ts Take out/take.mp4
```

有配音后，字幕按配音实际时长摊开，每个镜头至少等配音念完。换成正式配音时，把每段放到 `public/voice/s1.wav`…`s8.wav`，再跑 `node scripts/temp-voice.mjs --measure-only` 量时长。

## 约定

- 录屏坐标用网页的 CSS 像素，窗口内容是 1280×720。成片 1920×1080，不放大时正好铺满。
- 镜头键 `{t, x, y, zoom, dur}` 的意思是：从素材时间 t 开始，用 dur 秒（默认 0.8）平滑移到以 (x, y) 为中心、放大 zoom 倍的位置。放大后的可见范围不会超出网页。
- 片段 `rate > 1` 表示加速，画面右上角会自动标「已加速 ×N」。
- 字幕一行不超过 16 字，每秒不超过 9 字，英文字母和数字算半个字。句中的逗号句号显示成空格。
