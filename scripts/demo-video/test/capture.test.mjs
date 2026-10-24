import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  boxFromGeometry,
  cropFromBox,
  plausibleBox,
} from "../lib/geometry.mjs";
import { pickWindow } from "../lib/macwin.mjs";
import { decodePng, findMarkerBox, rgbAt } from "../lib/png.mjs";

// 造一张 RGBA PNG：白底，(bx,by) 起 bw×bh 的框画 border 宽的品红边；每行用不同的过滤类型，测解码
function markerPng(width, height, { bx, by, bw, bh, border }) {
  const rows = [];
  let prev = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x += 1) {
      const inBox = x >= bx && x < bx + bw && y >= by && y < by + bh;
      const edge =
        inBox &&
        (x < bx + border ||
          x >= bx + bw - border ||
          y < by + border ||
          y >= by + bh - border);
      row.set(edge ? [255, 0, 255, 255] : [250, 250, 250, 255], x * 4);
    }
    const filter = y % 3 === 0 ? 0 : y % 3 === 1 ? 1 : 2;
    const out = Buffer.alloc(width * 4 + 1);
    out[0] = filter;
    for (let i = 0; i < row.length; i += 1) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = prev[i];
      const pred = filter === 0 ? 0 : filter === 1 ? left : up;
      out[i + 1] = (row[i] - pred) & 0xff;
    }
    rows.push(out);
    prev = row;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([
      len,
      Buffer.from(type, "ascii"),
      data,
      Buffer.alloc(4),
    ]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("品红框校准", () => {
  test("解码 PNG 并找到品红框", () => {
    const png = markerPng(200, 150, {
      bh: 72,
      border: 3,
      bw: 128,
      bx: 10,
      by: 40,
    });
    const img = decodePng(png);
    assert.equal(img.width, 200);
    assert.deepEqual(rgbAt(img, 10, 40), [255, 0, 255]);
    assert.deepEqual(rgbAt(img, 50, 80), [250, 250, 250]);
    assert.deepEqual(findMarkerBox(img), {
      height: 72,
      width: 128,
      x: 10,
      y: 40,
    });
  });

  test("没有品红返回 null；不是 PNG 报错", () => {
    const png = markerPng(20, 20, { bh: 0, border: 0, bw: 0, bx: 0, by: 0 });
    assert.equal(findMarkerBox(decodePng(png)), null);
    assert.throws(() => decodePng(Buffer.from("not a png")));
  });

  test("大小差不多才算量对了", () => {
    assert.ok(
      plausibleBox({ height: 1440, width: 2560 }, { height: 1440, width: 2560 })
    );
    assert.ok(
      !plausibleBox({ height: 900, width: 2560 }, { height: 1440, width: 2560 })
    );
    assert.ok(!plausibleBox(null, { height: 1440, width: 2560 }));
  });
});

describe("裁剪", () => {
  test("窗口采集：裁掉标签栏、地址栏和右下的边", () => {
    // 窗口 1304×832 点，标签栏 + 地址栏 88 点，2 倍像素
    const source = { height: 1664, width: 2608 };
    const box = boxFromGeometry(source, {
      contentLeft: 0,
      contentTop: 88,
      mode: "window",
      outer: { height: 832, left: 24, top: 64, width: 1304 },
      screen: { height: 982, width: 1512 },
    });
    assert.deepEqual(box, {
      height: 1440,
      scale: 2,
      width: 2560,
      x: 0,
      y: 176,
    });
    assert.deepEqual(cropFromBox(box, source), {
      cropBottom: 1664 - 176 - 1440,
      cropLeft: 0,
      cropRight: 48,
      cropTop: 176,
      ok: true,
      scaleX: 1,
      scaleY: 1,
    });
  });

  test("整屏采集：加上窗口位置", () => {
    const source = { height: 1964, width: 3024 };
    const box = boxFromGeometry(source, {
      contentLeft: 0,
      contentTop: 88,
      mode: "display",
      outer: { height: 832, left: 24, top: 64, width: 1304 },
      screen: { height: 982, width: 1512 },
    });
    assert.equal(box.x, 48);
    assert.equal(box.y, (64 + 88) * 2);
    const crop = cropFromBox(box, source);
    assert.ok(crop.ok);
    assert.equal(crop.cropRight, 3024 - 48 - 2560);
  });

  test("框超出画面算不对", () => {
    assert.equal(
      cropFromBox(
        { height: 1440, width: 2560, x: 100, y: 0 },
        { height: 1440, width: 2600 }
      ).ok,
      false
    );
  });
});

describe("找 Chrome 窗口", () => {
  const bounds = { height: 832, left: 24, top: 64, width: 1304 };
  const windows = [
    {
      bounds: { Height: 900, Width: 1440, X: 0, Y: 25 },
      id: 1,
      layer: 0,
      owner: "Google Chrome",
      pid: 111,
    },
    {
      bounds: { Height: 832, Width: 1304, X: 24, Y: 64 },
      id: 2,
      layer: 0,
      owner: "Google Chrome",
      pid: 222,
    },
    {
      bounds: { Height: 24, Width: 1512, X: 0, Y: 0 },
      id: 3,
      layer: 25,
      owner: "Window Server",
      pid: 1,
    },
  ];

  test("同进程、位置大小对得上", () => {
    assert.equal(pickWindow(windows, { bounds, pid: 222 }).id, 2);
  });

  test("进程号对不上时按名字和位置认", () => {
    assert.equal(pickWindow(windows, { bounds, pid: 999 }).id, 2);
  });

  test("差太多就不认", () => {
    assert.equal(
      pickWindow(windows, { bounds: { ...bounds, left: 600 }, pid: 222 }),
      null
    );
  });
});
