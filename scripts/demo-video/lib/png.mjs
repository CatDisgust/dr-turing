import { inflateSync } from "node:zlib";

// 最小的 PNG 解码（8 位 RGB / RGBA / 灰度，不隔行），只用来校准 OBS 裁剪：
// 页面四周画一圈品红边框，OBS 截一帧原始画面，找品红框在哪，就知道网页内容在素材里的确切位置

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("不是 PNG");
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        bitDepth: data[8],
        colorType: data[9],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0),
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!header) {
    throw new Error("PNG 没有 IHDR");
  }
  const channels = CHANNELS[header.colorType];
  if (header.bitDepth !== 8 || !channels || header.interlace !== 0) {
    throw new Error(
      `不支持的 PNG 格式（位深 ${header.bitDepth}，颜色类型 ${header.colorType}，隔行 ${header.interlace}）`
    );
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c =
        x >= channels && y > 0 ? pixels[dst - stride + x - channels] : 0;
      pixels[dst + x] = (raw[src + x] + predict(filter, a, b, c)) & 0xff;
    }
  }
  return { channels, height, pixels, width };
}

function predict(filter, a, b, c) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) {
        return a;
      }
      return pb <= pc ? b : c;
    }
    default:
      throw new Error(`PNG 行过滤类型不对：${filter}`);
  }
}

export function rgbAt(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  if (img.channels < 3) {
    return [img.pixels[i], img.pixels[i], img.pixels[i]];
  }
  return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
}

const isMagenta = ([r, g, b]) => r > 190 && b > 190 && g < 90;

// 品红像素的外接框（素材像素）；一个都没有返回 null
export function findMarkerBox(img, test = isMagenta) {
  let left = img.width;
  let top = img.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (test(rgbAt(img, x, y))) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0) {
    return null;
  }
  return { height: bottom - top + 1, width: right - left + 1, x: left, y: top };
}
