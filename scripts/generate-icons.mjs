import {mkdir, writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';

// Reproducible local installation artwork; both variants fit the maskable safe area.
const colors = {background: [23, 27, 32], ink: [222, 193, 144], label: [23, 27, 32]};
function png(size, test) {
  const scale = 3, width = size * scale, pixels = Buffer.alloc(width * width * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = colors.background[i % 3];
  const dot = (x, y, radius, color) => {
    for (let row = Math.max(0, Math.floor(y - radius)); row <= Math.min(width - 1, y + radius); row++) {
      for (let col = Math.max(0, Math.floor(x - radius)); col <= Math.min(width - 1, x + radius); col++) {
        if ((col - x) ** 2 + (row - y) ** 2 > radius ** 2) continue;
        for (let c = 0; c < 3; c++) pixels[(row * width + col) * 3 + c] = color[c];
      }
    }
  };
  const line = (x1, y1, x2, y2, thickness = .012, color = colors.ink) => {
    const count = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * width * 2);
    for (let step = 0; step <= count; step++) dot((x1 + (x2 - x1) * step / count) * width, (y1 + (y2 - y1) * step / count) * width, thickness * width / 2, color);
  };
  const top = test ? .29 : .34, bottom = test ? .61 : .68;
  for (const side of [-1, 1]) {
    const edge = .5 + side * .24, middle = .5 + side * .12;
    line(.5, top + .045, middle, top); line(middle, top, edge, top + .015);
    line(edge, top + .015, edge, bottom); line(edge, bottom, middle, bottom - .015);
    line(middle, bottom - .015, .5, bottom + .045); line(.5, top + .045, .5, bottom + .045);
    for (const offset of [.11, .18, .25]) line(.5 + side * .055, top + offset, edge - side * .045, top + offset - .02, .008);
  }
  if (test) {
    const glyphs = {T: ['11111','00100','00100','00100','00100','00100','00100'], E: ['11111','10000','10000','11110','10000','10000','11111'], S: ['11111','10000','10000','11111','00001','00001','11111']};
    const unit = .012, start = .5 - 23 * unit / 2;
    for (let i = 0; i < 4; i++) for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      if (glyphs['TEST'[i]][row][col] === '1') line(start + (i * 6 + col) * unit, .735 + row * unit, start + (i * 6 + col + .7) * unit, .735 + row * unit, unit * .8);
    }
  }
  const scanlines = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) {
    let total = 0;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) total += pixels[((y * scale + sy) * width + x * scale + sx) * 3 + c];
    scanlines[y * (1 + size * 3) + 1 + x * 3 + c] = Math.round(total / scale ** 2);
  }
  const chunk = (name, data) => {
    const content = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const byte of content) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);}
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
for (const channel of ['production', 'test']) {
  const directory = new URL(`../assets/icons/${channel}/`, import.meta.url); await mkdir(directory, {recursive: true});
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) await writeFile(new URL(file, directory), png(size, channel === 'test'));
}
