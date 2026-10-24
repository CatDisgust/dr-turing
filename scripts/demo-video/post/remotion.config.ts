import { Config } from "@remotion/cli/config";

// 成片：H.264、BT.709、yuv420p，普通电脑和手机都能放；画质用 CRF 16
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
// 云端沙盒里没法下载 Chrome，用预装的；Mac 上不设这个变量就用 Remotion 自带的
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
}
