#!/usr/bin/env node
/**
 * make-icons.mjs - generates every web and PWA icon from one geometric description.
 *
 * Web browsers, iOS Safari ("Add to Home Screen"), desktop PWAs, and Android
 * maskable launchers each ask for a different raster size and safe-zone inset.
 * Describing the mark once in code guarantees every icon matches pixel-for-pixel:
 *
 *   apps/web/public/favicon.png            64x64    browser tab fallback
 *   apps/web/public/apple-touch-icon.png   180x180  iOS Safari home-screen icon
 *   apps/web/public/icon-192.png           192x192  PWA standard icon
 *   apps/web/public/icon-512.png           512x512  PWA splash & install prompt
 *   apps/web/public/maskable-icon-512.png  512x512  W3C maskable safe-zone icon
 *
 * The mark: two filled QR modules at opposite corners joined by a three-dash
 * beam representing fountain-coded frames in flight, supersampled 8x and
 * box-downsampled for clean diagonal anti-aliasing with zero image libraries.
 *
 * Usage: npm run gen:icons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const webPublicDir = resolve(here, '../apps/web/public');

const BACKGROUND = [0x0b, 0x0f, 0x14];
const MODULE = [0x6e, 0xe7, 0xff];

class Canvas {
  constructor(size, supersample = 8) {
    this.size = size;
    this.scale = supersample;
    this.width = size * supersample;
    this.pixels = new Uint8ClampedArray(this.width * this.width * 4);
  }

  clear(color, alpha = 255) {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = color[0];
      this.pixels[i + 1] = color[1];
      this.pixels[i + 2] = color[2];
      this.pixels[i + 3] = alpha;
    }
  }

  rect(x0, y0, x1, y1, color, radius = 0) {
    const px0 = Math.round(x0 * this.width);
    const py0 = Math.round(y0 * this.width);
    const px1 = Math.round(x1 * this.width);
    const py1 = Math.round(y1 * this.width);
    const r = radius * this.width;
    for (let y = py0; y < py1; y++) {
      for (let x = px0; x < px1; x++) {
        if (r > 0) {
          const cx = x < px0 + r ? px0 + r : x > px1 - r ? px1 - r : x;
          const cy = y < py0 + r ? py0 + r : y > py1 - r ? py1 - r : y;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > r * r) continue;
        }
        this.blend(x, y, color, 1);
      }
    }
  }

  segment(ax, ay, bx, by, width, color) {
    const axp = ax * this.width;
    const ayp = ay * this.width;
    const bxp = bx * this.width;
    const byp = by * this.width;
    const half = (width * this.width) / 2;
    const minX = Math.max(0, Math.floor(Math.min(axp, bxp) - half - 1));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(axp, bxp) + half + 1));
    const minY = Math.max(0, Math.floor(Math.min(ayp, byp) - half - 1));
    const maxY = Math.min(this.width - 1, Math.ceil(Math.max(ayp, byp) + half + 1));
    const dx = bxp - axp;
    const dy = byp - ayp;
    const lengthSquared = dx * dx + dy * dy || 1;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x - axp) * dx + (y - ayp) * dy) / lengthSquared));
        const px = axp + t * dx;
        const py = ayp + t * dy;
        const distance = Math.hypot(x - px, y - py);
        const coverage = Math.max(0, Math.min(1, half - distance + 0.5));
        if (coverage > 0) this.blend(x, y, color, coverage);
      }
    }
  }

  blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.width) return;
    const index = (y * this.width + x) * 4;
    const srcA = alpha;
    const dstA = this.pixels[index + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    this.pixels[index] = (color[0] * srcA + this.pixels[index] * dstA * (1 - srcA)) / outA;
    this.pixels[index + 1] = (color[1] * srcA + this.pixels[index + 1] * dstA * (1 - srcA)) / outA;
    this.pixels[index + 2] = (color[2] * srcA + this.pixels[index + 2] * dstA * (1 - srcA)) / outA;
    this.pixels[index + 3] = outA * 255;
  }

  finish() {
    const size = this.size;
    const s = this.scale;
    const out = new Uint8ClampedArray(size * size * 4);
    const samples = s * s;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < s; sy++) {
          for (let sx = 0; sx < s; sx++) {
            const index = ((y * s + sy) * this.width + (x * s + sx)) * 4;
            r += this.pixels[index];
            g += this.pixels[index + 1];
            b += this.pixels[index + 2];
            a += this.pixels[index + 3];
          }
        }
        const offset = (y * size + x) * 4;
        out[offset] = r / samples;
        out[offset + 1] = g / samples;
        out[offset + 2] = b / samples;
        out[offset + 3] = a / samples;
      }
    }
    return out;
  }
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0);
    return Buffer.concat([length, typeAndData, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function drawMark({ size, ink, background, inset = 0.14, moduleCorner = 0 }) {
  const canvas = new Canvas(size);
  canvas.clear(background ?? [0, 0, 0], background ? 255 : 0);

  const lo = inset;
  const hi = 1 - inset;
  const S = hi - lo;
  const moduleSize = S * 0.26;
  const beamWidth = S * 0.11;
  const dashGap = S * 0.045;
  const dashes = 3;

  const lowCentre = { x: lo + moduleSize / 2, y: hi - moduleSize / 2 };
  const highCentre = { x: hi - moduleSize / 2, y: lo + moduleSize / 2 };
  const centre = { x: (lo + hi) / 2, y: (lo + hi) / 2 };

  const diagonal = Math.SQRT1_2;
  const toCentre = { x: diagonal, y: -diagonal };
  const reachFromModule = (moduleSize / 2) * Math.SQRT2 + dashGap;
  const reachToCentre = Math.SQRT2 * (centre.x - lowCentre.x);
  const unit = (2 * (reachToCentre - reachFromModule)) / (2 * dashes - 1);

  const along = (origin, distance) => ({
    x: origin.x + toCentre.x * distance,
    y: origin.y + toCentre.y * distance,
  });

  for (let index = 0; index < dashes; index++) {
    const from = reachFromModule + index * 2 * unit;
    const start = along(lowCentre, from);
    const end = along(lowCentre, from + unit);
    canvas.segment(start.x, start.y, end.x, end.y, beamWidth, ink);
  }

  canvas.rect(
    lowCentre.x - moduleSize / 2,
    lowCentre.y - moduleSize / 2,
    lowCentre.x + moduleSize / 2,
    lowCentre.y + moduleSize / 2,
    ink,
    moduleCorner,
  );
  canvas.rect(
    highCentre.x - moduleSize / 2,
    highCentre.y - moduleSize / 2,
    highCentre.x + moduleSize / 2,
    highCentre.y + moduleSize / 2,
    ink,
    moduleCorner,
  );

  return encodePng(size, size, canvas.finish());
}

const outputs = [
  { file: 'favicon.png', size: 64, ink: MODULE, background: BACKGROUND, inset: 0.12 },
  { file: 'apple-touch-icon.png', size: 180, ink: MODULE, background: BACKGROUND, inset: 0.14 },
  { file: 'icon-192.png', size: 192, ink: MODULE, background: BACKGROUND, inset: 0.14 },
  { file: 'icon-512.png', size: 512, ink: MODULE, background: BACKGROUND, inset: 0.14 },
  // W3C maskable icons require important content within the inner 80% circle (inset >= 0.20).
  { file: 'maskable-icon-512.png', size: 512, ink: MODULE, background: BACKGROUND, inset: 0.22 },
];

mkdirSync(webPublicDir, { recursive: true });
for (const output of outputs) {
  const png = drawMark(output);
  const target = resolve(webPublicDir, output.file);
  writeFileSync(target, png);
  console.log(`apps/web/public/${output.file}  ${output.size}x${output.size}  ${(png.length / 1024).toFixed(1)} kB`);
}
