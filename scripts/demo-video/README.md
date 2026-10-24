# 演示视频录屏（第 2 版）

在 Mac 上用有界面的 Chrome 按镜头 3–7 操作线上网站，OBS 录 2560×1440 @ 60 的素材；每条录制留下日志、截图和自动判定，后期（`post/`，Remotion）靠日志对齐光标和镜头。

## 一次性准备

1. Node 20 以上，在本目录 `npm install`。没装 Google Chrome 的话再跑 `npx playwright install chromium`。
2. OBS 30 以上（macOS 13 以上）。系统设置 → 隐私与安全性 → 屏幕与系统录音：勾上 OBS，然后 ⌘Q 退出 OBS 再打开。
3. OBS「工具 → WebSocket 服务器设置」：勾上“启用 WebSocket 服务器”，端口 4455。密码脚本会自己从 OBS 的配置里读，不用抄；读不到时再 `export OBS_PASSWORD=…`。
4. 用 Retina 屏录（脚本按 2 倍像素算尺寸）。

场景 `DrTuring`、来源 `DrTuring Chrome`（macOS 屏幕采集，只抓这个 Chrome 窗口）、配置文件 `DrTuring`、画布 2560×1440 @ 60、录制质量（高质量，Apple H.264，mov）都由脚本自己建好、设好；录完切回原来的配置文件。裁剪靠网页四周临时画的一圈品红框量出来，量不到就按窗口位置推算。

录制时别碰鼠标键盘，别让别的窗口挡住 Chrome。脚本会用 `caffeinate -dimsu` 防止休眠。

## 命令

```sh
npm run rehearse                      # 彩排：不连 OBS，其余全跑（浏览器、日志、截图、判定）
npm run record                        # 录一条：镜头 3–7
npm run record -- --takes 3           # 连录 3 条，某条失败也接着录下一条
npm run record -- --from-shot 5       # 读回存档 after-shot-4，从镜头 5 录到 7
npm run record -- --shot 6            # 只重录镜头 6
npm run classify                      # 两句提问各问 20 次，看归到「死锁」的比例
npm run align -- out/<take>           # 录完后：用两次闪白把日志对到素材时间（要 ffmpeg）
npm test
```

`node record.mjs --help` 看全部选项。环境变量：`SITE`（默认线上别名，正式录建议固定成某次部署的地址）、`COURSE_ID`、`OBS_PASSWORD`、`OBS_URL`、`OBS_ENCODER`（apple_h264 / apple_hevc / x264）、`OBS_FORMAT`、`BROWSER_CHANNEL`、`WINDOW_LEFT` / `WINDOW_TOP`（Chrome 窗口位置，默认 24 / 64）。

镜头 3 前会 `POST /api/demo/reset` 清空重来；每个镜头判定通过就存档 `after-shot-N`（`/api/demo/snapshot`）。线上还没有存档接口时只提示，不中断。镜头 6、7 之间用 `/api/demo/next-day-shift` 把记录整体挪前一天，没有这个接口才退回 `/api/demo/next-day`。

`classify` 用的是 `/api/demo/compare`（`/api/eval/classify` 只跑评测集里的题）：要先在 `/compare` 页写入学生 A、B 的预置数据；每次还会给 A、B 各出一份规划，所以 40 次要等一会儿。

## 输出（`out/`，不进仓库）

每条录制一个文件夹 `out/<日期-时间>-t<n>/`：

| 文件 | 内容 |
| --- | --- |
| `screen.mov` | OBS 素材，开头、结尾各有一次 3 帧的闪白 |
| `log.json` | 页面事件（指针、按键和输入、滚动、界面变化、流式开始和结束、`dr:*` 事件）、脚本标记（`shot.N.start` 等）、`flash` 事件的时间（毫秒时间戳）；`footageViewport` 是网页在素材里的位置，`deployment` 记了部署号和 `x-vercel-id` |
| `verdict.json` | `{镜头: {pass, reasons[], warnings[], facts}}` |
| `tutor-text.md` | 导师回复原文，用来核对字幕 |
| `NN-*.png` | 关键时刻截图（网页 1280×720）；`obs-frame.png` 是 OBS 画面 |
| `aligned.json` | `align` 生成：光标、点击、镜头标记，单位是素材秒 |

另外 `out/<run>-summary.json` 是这次运行每条每镜的结果（终端也会打一张表），`out/snapshots.json` 记了每个存档那时的对话地址，`--from-shot 5/6` 要用。`classify` 的结果在 `out/classify-*.json`。
