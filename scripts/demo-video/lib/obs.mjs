import { readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import OBSWebSocket from "obs-websocket-js";
import {
  boxFromGeometry,
  CANVAS,
  cropFromBox,
  plausibleBox,
} from "./geometry.mjs";
import { decodePng, findMarkerBox } from "./png.mjs";

// 用 obs-websocket（v5，OBS 30 起自带）控制 OBS：专用配置文件 DrTuring（不动你自己的配置）、
// 画布 2560×1440 @ 60fps、高质量录制、场景 DrTuring 里一个“macOS 屏幕采集”源抓录屏用的 Chrome 窗口，
// 裁掉标签栏和地址栏只留网页内容；每条 StartRecord / StopRecord，拿到文件路径

export const PROFILE = "DrTuring";
export const SCENE = "DrTuring";
export const INPUT = "DrTuring Chrome";
const INPUT_KIND = "screen_capture";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ObsSetupError extends Error {}

const HELP = {
  auth: "OBS 密码不对：脚本会自动读 OBS 的 WebSocket 配置；读不到时在 OBS「工具 → WebSocket 服务器设置」点“显示连接信息”，把密码设成环境变量 OBS_PASSWORD 再跑。",
  connect:
    "连不上 OBS：打开 OBS，菜单「工具 → WebSocket 服务器设置」，勾上“启用 WebSocket 服务器”，端口 4455，点确定。OBS 要一直开着。",
  kind: "OBS 里没有“macOS 屏幕采集”（screen_capture）：需要 OBS 30 以上、macOS 13 以上。请升级 OBS。",
  permission:
    "OBS 抓不到画面：打开「系统设置 → 隐私与安全性 → 屏幕与系统录音」，打开 OBS 的开关，然后完全退出 OBS（⌘Q）再打开，重跑脚本。如果已经开着，在 OBS 里双击来源“DrTuring Chrome”，点一次“重新启动采集”。",
};

// 没设 OBS_PASSWORD 时，从 OBS 自己的 WebSocket 配置里读密码（macOS），这样密码不用经过任何人手。
// 读不到（没装 OBS、没开过 WebSocket、没开身份验证）返回 null
export function obsPassword() {
  if (process.env.OBS_PASSWORD) {
    return process.env.OBS_PASSWORD;
  }
  const file = join(
    homedir(),
    "Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json"
  );
  let config = null;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    config = null;
  }
  return config?.auth_required === false
    ? null
    : (config?.server_password ?? null);
}

export class ObsRecorder {
  constructor(say = console.log) {
    this.say = say;
    this.obs = new OBSWebSocket();
    this.listeners = new Set();
    this.info = {};
  }

  async connect() {
    const url = process.env.OBS_URL ?? "ws://127.0.0.1:4455";
    try {
      await this.obs.connect(url, obsPassword() ?? undefined, {
        rpcVersion: 1,
      });
    } catch (error) {
      const code = error?.code;
      throw new ObsSetupError(
        code === 4009 || code === 4008
          ? HELP.auth
          : `${HELP.connect}（${error?.message ?? error}）`,
        { cause: error }
      );
    }
    const version = await this.obs.call("GetVersion");
    this.info.version = {
      obs: version.obsVersion,
      platform: version.platformDescription,
      websocket: version.obsWebSocketVersion,
    };
    this.say(
      `OBS ${version.obsVersion}（websocket ${version.obsWebSocketVersion}）已连上`
    );
    this.obs.on("RecordStateChanged", (event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  call(name, data) {
    return this.obs.call(name, data);
  }

  async waitFor(check, timeout, label) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      // biome-ignore lint/performance/noAwaitInLoops: 轮询 OBS 状态，一次一次问
      const value = await check();
      if (value) {
        return value;
      }
      await sleep(250);
    }
    throw new ObsSetupError(`等 OBS ${label} 超时`);
  }

  // 用专用配置文件，录制设置和画布大小都放在它里面
  async selectProfile() {
    const { currentProfileName, profiles } = await this.call("GetProfileList");
    this.originalProfile = currentProfileName;
    this.profiles = profiles;
    if (!profiles.includes(PROFILE)) {
      await this.call("CreateProfile", { profileName: PROFILE });
    } else if (currentProfileName !== PROFILE) {
      await this.call("SetCurrentProfile", { profileName: PROFILE });
    }
    await this.waitFor(
      async () =>
        (await this.call("GetProfileList")).currentProfileName === PROFILE,
      8000,
      `切到配置文件 ${PROFILE}`
    );
  }

  async configureVideo() {
    const status = await this.call("GetRecordStatus");
    if (status.outputActive) {
      this.say("OBS 还在录（上次没停？），先停掉");
      await this.call("StopRecord");
      await sleep(2000);
    }
    await this.call("SetVideoSettings", {
      baseHeight: CANVAS.height,
      baseWidth: CANVAS.width,
      fpsDenominator: 1,
      fpsNumerator: 60,
      outputHeight: CANVAS.height,
      outputWidth: CANVAS.width,
    });
    const video = await this.call("GetVideoSettings");
    this.info.video = video;
    if (
      video.baseWidth !== CANVAS.width ||
      video.outputHeight !== CANVAS.height ||
      video.fpsNumerator / video.fpsDenominator !== 60
    ) {
      throw new ObsSetupError(
        `OBS 画布没设成 2560×1440@60：${JSON.stringify(video)}`
      );
    }
  }

  // 简单输出模式 + “高质量，文件大”（HQ）+ 苹果硬件编码，mov。编码器和质量只在 OBS 重建输出时读，
  // 改了就切一下配置文件再切回来让它生效
  async configureOutput(recordDir) {
    const encoder = process.env.OBS_ENCODER ?? "apple_h264";
    const format = process.env.OBS_FORMAT ?? "mov";
    const wanted = [
      ["Output", "Mode", "Simple", true],
      ["SimpleOutput", "RecQuality", "HQ", true],
      ["SimpleOutput", "RecEncoder", encoder, true],
      ["SimpleOutput", "RecFormat2", format, false],
      ["SimpleOutput", "RecFormat", format, false],
      ["SimpleOutput", "RecRB", "false", false],
      ["SimpleOutput", "FilePath", recordDir, false],
    ];
    let reload = false;
    for (const [
      parameterCategory,
      parameterName,
      value,
      needsReload,
    ] of wanted) {
      // biome-ignore lint/performance/noAwaitInLoops: 一个参数一个参数读、改
      const current = await this.call("GetProfileParameter", {
        parameterCategory,
        parameterName,
      });
      const now = current.parameterValue ?? current.defaultParameterValue;
      if (now !== value) {
        await this.call("SetProfileParameter", {
          parameterCategory,
          parameterName,
          parameterValue: value,
        });
        reload ||= needsReload;
      }
    }
    if (reload) {
      const other =
        this.originalProfile === PROFILE
          ? this.profiles.find((p) => p !== PROFILE)
          : this.originalProfile;
      if (other) {
        this.say("录制设置改了，切一下配置文件让 OBS 重建输出");
        await this.call("SetCurrentProfile", { profileName: other });
        await sleep(1500);
        await this.call("SetCurrentProfile", { profileName: PROFILE });
        await this.waitFor(
          async () =>
            (await this.call("GetProfileList")).currentProfileName === PROFILE,
          8000,
          "切回配置文件"
        );
        await sleep(1000);
      } else {
        this.say(
          "注意：录制设置改了，但没有别的配置文件可切：请重启一次 OBS 让设置生效"
        );
      }
    }
    const read = async (parameterCategory, parameterName) =>
      (
        await this.call("GetProfileParameter", {
          parameterCategory,
          parameterName,
        })
      ).parameterValue;
    this.info.output = {
      encoder: await read("SimpleOutput", "RecEncoder"),
      format: await read("SimpleOutput", "RecFormat2"),
      mode: await read("Output", "Mode"),
      quality: await read("SimpleOutput", "RecQuality"),
    };
    this.say(`OBS 录制：${JSON.stringify(this.info.output)}`);
  }

  async ensureScene() {
    const { scenes } = await this.call("GetSceneList");
    if (!scenes.some((s) => s.sceneName === SCENE)) {
      await this.call("CreateScene", { sceneName: SCENE });
    }
    await this.call("SetCurrentProgramScene", { sceneName: SCENE });
  }

  async sourceSize(sceneItemId) {
    const { sceneItemTransform: t } = await this.call("GetSceneItemTransform", {
      sceneItemId,
      sceneName: SCENE,
    });
    return t.sourceWidth > 0 && t.sourceHeight > 0
      ? { height: t.sourceHeight, width: t.sourceWidth }
      : null;
  }

  // 建（或更新）采集源，等它出画面，然后量出网页内容的位置并裁剪。
  // marker(on)：在页面四周画 / 去掉品红框；geometry：量品红框失败时用来推算的窗口几何
  async ensureCapture({ mode, windowId, marker, geometry }) {
    const inputSettings =
      mode === "window"
        ? {
            show_cursor: false,
            show_hidden_windows: false,
            type: 1,
            window: windowId,
          }
        : { hide_obs: true, show_cursor: false, type: 0 };
    const { inputs } = await this.call("GetInputList");
    const existing = inputs.find((i) => i.inputName === INPUT);
    if (existing && existing.inputKind !== INPUT_KIND) {
      await this.call("RemoveInput", { inputName: INPUT });
    }
    if (existing && existing.inputKind === INPUT_KIND) {
      await this.call("SetInputSettings", {
        inputName: INPUT,
        inputSettings,
        overlay: true,
      });
      await this.call("GetSceneItemId", {
        sceneName: SCENE,
        sourceName: INPUT,
      }).catch(() =>
        this.call("CreateSceneItem", { sceneName: SCENE, sourceName: INPUT })
      );
    } else {
      try {
        await this.call("CreateInput", {
          inputKind: INPUT_KIND,
          inputName: INPUT,
          inputSettings,
          sceneItemEnabled: true,
          sceneName: SCENE,
        });
      } catch (error) {
        throw new ObsSetupError(`${HELP.kind}（${error?.message ?? error}）`, {
          cause: error,
        });
      }
    }
    const { sceneItemId } = await this.call("GetSceneItemId", {
      sceneName: SCENE,
      sourceName: INPUT,
    });
    this.sceneItemId = sceneItemId;
    // 场景里只留这一个源
    const { sceneItems } = await this.call("GetSceneItemList", {
      sceneName: SCENE,
    });
    for (const item of sceneItems) {
      // biome-ignore lint/performance/noAwaitInLoops: 一个一个设
      await this.call("SetSceneItemEnabled", {
        sceneItemEnabled: item.sceneItemId === sceneItemId,
        sceneItemId: item.sceneItemId,
        sceneName: SCENE,
      });
    }

    let source = await this.waitFor(
      () => this.sourceSize(sceneItemId),
      8000,
      "采集源出画面"
    ).catch(() => null);
    if (!source) {
      await this.call("PressInputPropertiesButton", {
        inputName: INPUT,
        propertyName: "reactivate_capture",
      }).catch(() => null);
      source = await this.waitFor(
        () => this.sourceSize(sceneItemId),
        8000,
        "采集源出画面"
      ).catch(() => null);
    }
    if (!source) {
      throw new ObsSetupError(HELP.permission);
    }

    const measured = await this.measureMarker(marker, source);
    const expected = { height: 720 * geometry.dpr, width: 1280 * geometry.dpr };
    let box = measured;
    let how = "marker";
    if (!plausibleBox(measured, expected)) {
      this.say(
        `注意：没量到品红校准框（${JSON.stringify(measured)}），按窗口几何推算裁剪；录完请对比 out/<take>/obs-frame.png`
      );
      box = boxFromGeometry(source, { ...geometry, mode });
      how = "geometry";
    }
    const crop = cropFromBox(box, source);
    if (!crop.ok) {
      throw new ObsSetupError(
        `算出来的裁剪不对（源 ${source.width}×${source.height}，内容框 ${JSON.stringify(box)}）。Chrome 窗口是不是被挡住或拖到了别的屏幕？`
      );
    }
    await this.call("SetSceneItemTransform", {
      sceneItemId,
      sceneItemTransform: {
        alignment: 5,
        boundsType: "OBS_BOUNDS_NONE",
        cropBottom: crop.cropBottom,
        cropLeft: crop.cropLeft,
        cropRight: crop.cropRight,
        cropTop: crop.cropTop,
        positionX: 0,
        positionY: 0,
        rotation: 0,
        scaleX: crop.scaleX,
        scaleY: crop.scaleY,
      },
      sceneName: SCENE,
    });
    this.info.capture = { box, crop, how, inputSettings, mode, source };
    this.say(
      `OBS 采集：${mode === "window" ? `窗口 #${windowId}` : "整块屏幕"}，源 ${source.width}×${source.height}，裁剪 ${JSON.stringify(crop)}（${how}）`
    );
    if (Math.abs(crop.scaleX - 1) > 0.01) {
      this.say(
        `注意：网页在素材里不是 2 倍像素（缩放 ${crop.scaleX.toFixed(3)}）：Chrome 窗口要放在 Retina 屏幕上`
      );
    }
    return this.info.capture;
  }

  // 截一帧采集源的原始画面，找品红框
  async measureMarker(marker, source) {
    const file = join(tmpdir(), `drturing-obs-marker-${process.pid}.png`);
    try {
      await marker(true);
      await sleep(500);
      await this.call("SaveSourceScreenshot", {
        imageFilePath: file,
        imageFormat: "png",
        imageHeight: source.height,
        imageWidth: source.width,
        sourceName: INPUT,
      });
      return findMarkerBox(decodePng(readFileSync(file)));
    } catch (error) {
      this.say(`注意：品红框校准失败：${error?.message ?? error}`);
      return null;
    } finally {
      await marker(false).catch(() => null);
      rmSync(file, { force: true });
    }
  }

  async saveFrame(path) {
    await this.call("SaveSourceScreenshot", {
      imageFilePath: path,
      imageFormat: "png",
      imageHeight: CANVAS.height / 2,
      imageWidth: CANVAS.width / 2,
      sourceName: SCENE,
    });
  }

  waitRecordState(state, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`等 OBS 录制状态 ${state} 超时`));
      }, timeout);
      const listener = (event) => {
        if (event.outputState === state) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(event);
        }
      };
      this.listeners.add(listener);
    });
  }

  async startRecording(dir) {
    try {
      await this.call("SetRecordDirectory", { recordDirectory: dir });
    } catch {
      await this.call("SetProfileParameter", {
        parameterCategory: "SimpleOutput",
        parameterName: "FilePath",
        parameterValue: dir,
      });
    }
    const started = this.waitRecordState(
      "OBS_WEBSOCKET_OUTPUT_STARTED",
      20_000
    );
    await this.call("StartRecord");
    await started;
    this.recording = true;
  }

  async stopRecording() {
    if (!this.recording) {
      return null;
    }
    const stopped = this.waitRecordState(
      "OBS_WEBSOCKET_OUTPUT_STOPPED",
      120_000
    );
    const response = await this.call("StopRecord");
    this.recording = false;
    const event = await stopped.catch(() => null);
    return event?.outputPath ?? response?.outputPath ?? null;
  }

  async restore() {
    if (this.originalProfile && this.originalProfile !== PROFILE) {
      await this.call("SetCurrentProfile", {
        profileName: this.originalProfile,
      }).catch(() => null);
    }
  }

  async disconnect() {
    await this.obs.disconnect().catch(() => null);
  }
}
