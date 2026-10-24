import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passwordFromIni } from "../lib/obs.mjs";

// 新版 OBS 把 WebSocket 密码存在 global.ini 的 [OBSWebSocket] 段

describe("passwordFromIni", () => {
  const ini = (auth, password) =>
    `[General]\nServerPassword=not-this\n\n[OBSWebSocket]\nServerEnabled=true\nServerPort=4455\nAuthRequired=${auth}\nServerPassword=${password}\n\n[Other]\nServerPassword=nope\n`;

  it("只取 [OBSWebSocket] 段的密码，密码里有等号也完整", () => {
    assert.equal(passwordFromIni(ini("true", "ab=c$D9")), "ab=c$D9");
  });

  it("没开身份验证就不要密码", () => {
    assert.equal(passwordFromIni(ini("false", "secret")), null);
  });

  it("没有这一段、没有文件都返回 null", () => {
    assert.equal(passwordFromIni("[General]\nFoo=1\n"), null);
    assert.equal(passwordFromIni(null), null);
  });

  it("Windows 换行也能读", () => {
    assert.equal(
      passwordFromIni(
        "[OBSWebSocket]\r\nAuthRequired=true\r\nServerPassword=x1\r\n"
      ),
      "x1"
    );
  });
});
