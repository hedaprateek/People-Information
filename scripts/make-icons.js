#!/usr/bin/env node
/**
 * Writes icons/icon-192.png, icon-512.png and apple-touch-icon.png — the
 * home-screen icons for the installed app.
 *
 *   node scripts/make-icons.js
 *
 * Written by hand rather than pulled from a library: the project has no npm
 * dependencies and npm is not reachable here. A PNG is a signature, three
 * chunks and a CRC, and zlib ships with Node.
 *
 * The mark is the same one in the favicon — a house on the brand gradient —
 * drawn full-bleed so Android can mask it to whatever shape it likes.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- a minimal PNG encoder ---------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return buf => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

/** pixels: (x, y) -> [r, g, b, a], each 0-255 */
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;                        // filter: none
    for (let x = 0; x < size; x++) {
      const c = pixel(x, y, size);
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2]; raw[p++] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- the mark ---------- */
const NAVY = [0x0a, 0x16, 0x28];
const TEAL = [0x0e, 0xa5, 0xc8];
const GOLD = [0xe0, 0xa8, 0x1e];
const mix = (a, b, k) => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k)
];

/* Android masks an icon to a circle, a squircle or a rounded square and can
   crop up to ~10% off each edge, so the house sits inside the middle 60%. */
function draw(x, y, size) {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;   // 0..1
  const g = mix(TEAL, GOLD, Math.min(1, Math.max(0, (u + v) / 2)));

  // house, centred, 46% of the canvas wide
  const cx = 0.5, roofTop = 0.30, eaves = 0.47, base = 0.71;
  const halfBody = 0.155, halfRoof = 0.235;

  const inBody = u > cx - halfBody && u < cx + halfBody && v >= eaves && v <= base;
  // roof: a triangle from the apex down to the eaves
  const t = (v - roofTop) / (eaves - roofTop);
  const inRoof = v >= roofTop && v <= eaves &&
                 Math.abs(u - cx) <= halfRoof * t;
  // a doorway punched out of the body, so it reads as a house at 48px
  const inDoor = u > cx - 0.052 && u < cx + 0.052 && v > 0.575 && v <= base;

  if ((inBody || inRoof) && !inDoor) return [g[0], g[1], g[2], 255];
  return [NAVY[0], NAVY[1], NAVY[2], 255];
}

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]
]) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, png(size, draw));
  console.log("wrote " + name + "  " + size + "x" + size +
              "  " + fs.statSync(file).size + " bytes");
}
