/**
 * render.ts - turning a module grid into pixels.
 *
 * The single most important decision here is *where* upscaling happens:
 *
 *   Bad  (slow): expand every module to scale x scale pixels in JavaScript.
 *                A 57x57 module symbol at scale 8 is 456x456 pixels; building
 *                that buffer costs a quarter of a million writes per frame and
 *                stalls the JS thread at 15-30 fps.
 *
 *   Good (fast): emit ONE pixel per module (57x57 = 3.2k writes) and let the
 *                platform upscale it with nearest-neighbour sampling. Skia
 *                WebGL and Canvas2D (`image-rendering: pixelated`) both do this on the GPU
 *                with `imageSmoothingEnabled = false`, which yields perfectly
 *                crisp square modules and costs effectively nothing.
 *
 * Every renderer in LightBeam therefore consumes `rasterizeRgba()` at module
 * resolution. `rasterizeMono()` (1 byte/pixel) exists for tests, and `toSvg()`
 * for documentation and static exports.
 */

import type { EncodedSymbol } from './encoder.js';

/** RGBA colour as [r, g, b, a] with components in 0..255. */
export type Rgba = readonly [number, number, number, number];

export interface RenderOptions {
  /** Light (background) colour. Default: white, fully opaque. */
  light?: Rgba;
  /** Dark (ink) colour. Default: black, fully opaque. */
  dark?: Rgba;
  /** Quiet zone in modules. ISO 18004 requires 4; 2 is workable on a screen. */
  quietZone?: number;
  /** Pixels per module. Use 1 for GPU upscaling, more for debug images. */
  scale?: number;
}

export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
  /** Modules per axis, excluding the quiet zone. */
  moduleSize: number;
  scale: number;
  quietZone: number;
}

export interface MonoBitmap {
  width: number;
  height: number;
  /** 1 byte per pixel: 1 = dark ink, 0 = light. */
  data: Uint8Array;
  moduleSize: number;
  scale: number;
  quietZone: number;
}

export const WHITE: Rgba = [255, 255, 255, 255];
export const BLACK: Rgba = [0, 0, 0, 255];

/**
 * Rasterise a symbol to an RGBA buffer.
 *
 * Default is 1 pixel per module plus a quiet zone, ready to be drawn stretched
 * with nearest-neighbour sampling. Pass `scale` > 1 to get a standalone image
 * (used by tests, by the PNG/SVG export, and by the share sheet).
 */
export function rasterizeRgba(symbol: EncodedSymbol, options: RenderOptions = {}): RgbaImage {
  const light = options.light ?? WHITE;
  const dark = options.dark ?? BLACK;
  const quietZone = options.quietZone ?? 2;
  const scale = Math.max(1, options.scale ?? 1);
  const modules = symbol.size;
  const moduleSize = modules + quietZone * 2;
  const width = moduleSize * scale;
  const height = moduleSize * scale;
  const data = new Uint8Array(width * height * 4);

  // Fill the background row by row (cheaper than per-pixel branching).
  const bg = bytes(light);
  const ink = bytes(dark);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = bg[3];
  }

  const mods = symbol.modules;
  for (let y = 0; y < modules; y++) {
    const rowBase = y * modules;
    // Vertical offset in destination pixels.
    const dy0 = (y + quietZone) * scale;
    for (let x = 0; x < modules; x++) {
      if (!mods[rowBase + x]) continue;
      const dx0 = (x + quietZone) * scale;
      for (let sy = 0; sy < scale; sy++) {
        let p = ((dy0 + sy) * width + dx0) * 4;
        for (let sx = 0; sx < scale; sx++) {
          data[p] = ink[0];
          data[p + 1] = ink[1];
          data[p + 2] = ink[2];
          data[p + 3] = ink[3];
          p += 4;
        }
      }
    }
  }

  return { width, height, data, moduleSize: modules, scale, quietZone };
}

/** Rasterise to a 1-byte-per-pixel bitmap (tests, OCR-style tooling, debugging). */
export function rasterizeMono(symbol: EncodedSymbol, options: RenderOptions = {}): MonoBitmap {
  const quietZone = options.quietZone ?? 2;
  const scale = Math.max(1, options.scale ?? 1);
  const modules = symbol.size;
  const moduleSize = modules + quietZone * 2;
  const width = moduleSize * scale;
  const height = moduleSize * scale;
  const data = new Uint8Array(width * height);
  const mods = symbol.modules;
  for (let y = 0; y < modules; y++) {
    const dy0 = (y + quietZone) * scale;
    for (let x = 0; x < modules; x++) {
      if (!mods[y * modules + x]) continue;
      const dx0 = (x + quietZone) * scale;
      for (let sy = 0; sy < scale; sy++) {
        const rowStart = (dy0 + sy) * width + dx0;
        data.fill(1, rowStart, rowStart + scale);
      }
    }
  }
  return { width, height, data, moduleSize: modules, scale, quietZone };
}

/**
 * Convert an RGBA image to the [r,g,b,a] byte array a Canvas ImageData needs.
 * (Identity today, but this keeps the platform adapters free of assumptions
 * about the buffer type and documents the intended use.)
 */
export function imageDataBytes(image: RgbaImage): Uint8Array {
  return image.data;
}

/**
 * Vector rendering: one `<path>` with a sub-path per dark module.
 *
 * Using `d` with horizontal runs instead of individual 1x1 rects keeps the SVG
 * small (a version-40 symbol would otherwise emit ~15k rect elements), which
 * matters because this output is also used for the "export a static symbol"
 * feature and for the pixel-perfect README images.
 */
export function toSvg(symbol: EncodedSymbol, options: RenderOptions = {}): string {
  const light = options.light ?? WHITE;
  const dark = options.dark ?? BLACK;
  const quietZone = options.quietZone ?? 4;
  const scale = options.scale ?? 8;
  const modules = symbol.size;
  const moduleSize = modules + quietZone * 2;
  const sizePx = moduleSize * scale;

  const parts: string[] = [];
  for (let y = 0; y < modules; y++) {
    let x = 0;
    while (x < modules) {
      if (!symbol.modules[y * modules + x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < modules && symbol.modules[y * modules + x + run]) run++;
      parts.push(`M${(x + quietZone) * scale} ${(y + quietZone) * scale}h${run * scale}v${scale}h${-run * scale}z`);
      x += run;
    }
  }

  const css = (c: Rgba): string =>
    c[3] === 255 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" shape-rendering="crispEdges">`,
    `<rect width="${sizePx}" height="${sizePx}" fill="${css(light)}"/>`,
    `<path d="${parts.join('')}" fill="${css(dark)}"/>`,
    `</svg>`,
  ].join('');
}

/**
 * The same geometry as `toSvg`, expressed as a path `d` string in MODULE units.
 *
 * This is what the native app renders, and the reason it exists is performance:
 *
 *   - A `<View>` per dark module would be ~1800 views for a 77-module symbol,
 *     rebuilt 15 times a second, thrashing the browser DOM layout engine.
 *   - A single `<path>` element inside an inline `<svg>` is ONE DOM node whose `d` attribute
 *     is re-filled each frame. Combined with a fixed `viewBox`, the symbol can be
 *     swapped at the display refresh rate without touching the view hierarchy.
 *
 * Module units (not pixels) matter too: the caller sets width/height and the GPU
 * scales, so the same path renders identically on a 4" phone and a tablet with no
 * re-rasterisation in JavaScript.
 *
 * Adjacent dark modules in a row are merged into one rectangle (`h<run>`), which
 * keeps the string around 3 kB for a large symbol instead of 15 kB. That is not
 * just tidiness: every byte here is parsed on the UI thread of a phone that is
 * simultaneously running a camera at 15 fps.
 */
export function toSvgPath(symbol: EncodedSymbol, options: { quietZone?: number } = {}): string {
  const quietZone = options.quietZone ?? 4;
  const modules = symbol.size;
  const parts: string[] = [];
  for (let y = 0; y < modules; y++) {
    let x = 0;
    while (x < modules) {
      if (!symbol.modules[y * modules + x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < modules && symbol.modules[y * modules + x + run]) run++;
      // M<absolute x> <absolute y> then h<run> v1 h-<run> z, in module units.
      parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h${-run}z`);
      x += run;
    }
  }
  return parts.join('');
}

/** Total modules per axis including the quiet zone: the SVG viewBox size. */
export function moduleCountWithQuietZone(symbol: EncodedSymbol, quietZone = 4): number {
  return symbol.size + quietZone * 2;
}

function bytes(color: Rgba): [number, number, number, number] {
  return [color[0], color[1], color[2], color[3]];
}

/**
 * Ink coverage of a symbol (fraction of dark modules). The optical channel
 * benefits from a balanced symbol: very dark or very light frames are harder to
 * threshold. The encoder's N4 penalty already nudges towards 50%, and this is
 * the metric the diagnostics screen reports.
 */
export function inkCoverage(symbol: EncodedSymbol): number {
  let dark = 0;
  for (let i = 0; i < symbol.modules.length; i++) dark += symbol.modules[i];
  return dark / symbol.modules.length;
}
