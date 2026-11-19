// The app logo — a cartoon "pie eye" — drawn pixel by pixel, so no image files are needed.
// Used for the window/tray icon; run `node desktop/icon.js` to regenerate the extension's PNG icons.
const zlib = require('zlib'), fs = require('fs'), path = require('path');

const INK = [14, 14, 16], AMBER = [242, 179, 61], CREAM = [239, 233, 219];

/** Returns size*size RGBA bytes. Geometry matches the SVG logo in index.html (48-unit grid). */
function drawIcon(size) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + .5) / ss) / size * 48 - 24, v = (y + (sy + .5) / ss) / size * 48 - 24;
      const d = Math.hypot(u, v), ang = Math.atan2(v, u) * 180 / Math.PI;
      if (d > 22) continue;
      let c = INK;
      if (d >= 19 && d <= 21) c = AMBER;
      if (d <= 15) c = d <= 10 && !(ang > -70 && ang < -20) ? INK : CREAM; // pupil with a wedge cut out
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const i = (y * size + x) * 4;
    if (a) { buf[i] = r / a; buf[i + 1] = g / a; buf[i + 2] = b / a; buf[i + 3] = 255 * a / (ss * ss); }
  }
  return buf;
}

function png(size) {
  const rgba = drawIcon(size), raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A Windows .ico file holding the logo at several sizes (PNG-encoded entries). */
function ico() {
  const sizes = [16, 32, 48, 256], images = sizes.map(png), head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = head[e + 1] = s === 256 ? 0 : s; // 0 means 256
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

module.exports = { drawIcon, ico };

if (require.main === module) {
  for (const size of [16, 48, 128]) {
    const file = path.join(__dirname, '..', 'extension', `icon${size}.png`);
    fs.writeFileSync(file, png(size));
    console.log('wrote', file);
  }
}
