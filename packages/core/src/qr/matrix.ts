/**
 * matrix.ts - QR Code symbol construction: function patterns, format/version
 * information, data placement (the "zigzag"), and data masking.
 *
 * The module grid is stored redundantly in three parallel Uint8Arrays, which is
 * what makes the frame loop fast enough for video-rate symbol generation:
 *
 *   modules[i]     final colour of module i (0 = light, 1 = dark)
 *   bitMask[i]     the data bit placed at module i (1 if that bit was 1)
 *   isFunction[i]  1 if module i belongs to a function pattern or to the
 *                  format/version information area (i.e. carries no data)
 *
 * Because the function-pattern layer never changes for a given
 * (version, EC level) - and the data layer is just codewords poured into a
 * fixed sequence of positions - we can rasterise frames without ever building
 * a 2D array or touching the mask pattern selection. See encoder.ts.
 */

import { ALIGNMENT_PATTERN_COORDS, VERSION_INFO_BITS } from './tables.js';
import type { EcLevel } from './tables.js';

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  /** Final module colour: 0 = light, 1 = dark. */
  readonly modules: Uint8Array;
  /** Data bit at each module (meaningful only where isFunction === 0). */
  readonly bitMask: Uint8Array;
  /** 1 = function pattern / format info area (no data stored). */
  readonly isFunction: Uint8Array;
  /** Fixed function-pattern layer, ready to copy for every generated frame. */
  readonly functionLayer: Uint8Array;
}

/** Module index for (x = column, y = row) in row-major order. */
export function idx(size: number, x: number, y: number): number {
  return y * size + x;
}

export function emptyMatrix(version: number): QrMatrix {
  const size = 17 + version * 4;
  const n = size * size;
  return {
    version,
    size,
    modules: new Uint8Array(n),
    bitMask: new Uint8Array(n),
    isFunction: new Uint8Array(n),
    functionLayer: new Uint8Array(n),
  };
}

function setFunction(m: QrMatrix, x: number, y: number, dark: number): void {
  const i = idx(m.size, x, y);
  m.functionLayer[i] = dark ? 1 : 0;
  m.isFunction[i] = 1;
}

/**
 * Draw every function pattern:
 *   - three 7x7 finder patterns plus their 1-module separators,
 *   - the alternating timing patterns in row 6 and column 6,
 *   - alignment patterns (2+ per row/column grid, skipped at the corners),
 *   - the reserved format-information areas and, for versions >= 7, the two
 *     version-information blocks,
 *   - the always-dark module at (8, size - 8).
 * The actual format/version *values* are written later by drawFormatInfo /
 * drawVersionInfo; here we only reserve the modules.
 */
export function buildFunctionLayer(m: QrMatrix): void {
  const size = m.size;

  // --- finder patterns + separators -----------------------------------------
  const drawFinder = (cx: number, cy: number): void => {
    // cx, cy are the top-left coordinates of the 9x9 area including separator.
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        // 7x7 rings: outer ring dark, 1-module light gap, 3x3 dark core.
        const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const isDark =
          inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunction(m, x, y, isDark ? 1 : 0);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // --- timing patterns -------------------------------------------------------
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    setFunction(m, i, 6, dark);
    setFunction(m, 6, i, dark);
  }

  // --- alignment patterns ----------------------------------------------------
  const coords = alignmentCoords(m.version);
  const last = coords.length - 1;
  for (let a = 0; a < coords.length; a++) {
    for (let b = 0; b < coords.length; b++) {
      // Skip the three positions occupied by finder patterns.
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
      const cx = coords[a];
      const cy = coords[b];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0;
          setFunction(m, cx + dx, cy + dy, dark);
        }
      }
    }
  }

  // --- format information reservation ---------------------------------------
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunction(m, 8, i, 0);
      setFunction(m, i, 8, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(m, size - 1 - i, 8, 0);
    setFunction(m, 8, size - 1 - i, 0);
  }

  // --- version information reservation (versions 7+) ------------------------
  if (m.version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(m, a, b, 0);
      setFunction(m, b, a, 0);
    }
  }

  // --- the always-dark module -----------------------------------------------
  setFunction(m, 8, size - 8, 1);

  // Copy the function layer into the working modules array.
  m.modules.set(m.functionLayer);
}

/**
 * Alignment pattern centre coordinates for a version. The table comes from
 * ISO/IEC 18004 Annex E (generated into tables.ts); version 1 has none.
 */
function alignmentCoords(version: number): number[] {
  return ALIGNMENT_PATTERN_COORDS[version] ?? [];
}

/**
 * Format information: 5 data bits (2 EC level + 3 mask) encoded with the
 * (15,5) BCH code, generator polynomial 0b101_0011_0111 (0x537), then XORed
 * with the mask 0b101010000010010 (0x5412) so that the all-zero format never
 * produces an all-light row (which would look like a finder pattern).
 */
export function formatInfoBits(ecLevel: EcLevel, mask: number): number {
  const ecBits = { L: 1, M: 0, Q: 3, H: 2 }[ecLevel];
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  while (bitLength(rem) - 11 >= 0) rem ^= 0x537 << (bitLength(rem) - 11);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function bitLength(value: number): number {
  return 32 - Math.clz32(value);
}

/** Write both copies of the 15 format modules. */
export function drawFormatInfo(m: QrMatrix, ecLevel: EcLevel, mask: number): void {
  const bits = formatInfoBits(ecLevel, mask);
  const size = m.size;
  const bit = (i: number): number => (bits >>> i) & 1;

  // Copy 1: around the top-left finder pattern.
  for (let i = 0; i <= 5; i++) setFunction(m, 8, i, bit(i));
  setFunction(m, 8, 7, bit(6));
  setFunction(m, 8, 8, bit(7));
  setFunction(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(m, 14 - i, 8, bit(i));

  // Copy 2: split between the top-right and bottom-left finder patterns.
  for (let i = 0; i < 8; i++) setFunction(m, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(m, 8, size - 15 + i, bit(i));

  // The dark module is part of the format area and must survive the copy.
  setFunction(m, 8, size - 8, 1);

  // Re-apply the reserved function layer over the data area.
  applyFunctionLayer(m);
}

/** Write both copies of the 18-bit version information (versions 7+). */
export function drawVersionInfo(m: QrMatrix): void {
  if (m.version < 7) return;
  const bits = VERSION_INFO_BITS[m.version];
  const size = m.size;
  for (let i = 0; i < 18; i++) {
    const dark = (bits >>> i) & 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(m, a, b, dark);
    setFunction(m, b, a, dark);
  }
  applyFunctionLayer(m);
}

/** Rebuild `modules` from the frozen function layer (fast: one memcpy). */
export function applyFunctionLayer(m: QrMatrix): void {
  const len = m.modules.length;
  const src = m.functionLayer;
  const dst = m.modules;
  for (let i = 0; i < len; i++) if (m.isFunction[i]) dst[i] = src[i];
}

/**
 * Place data codewords into the symbol.
 *
 * The traversal is specified in ISO/IEC 18004 7.7.3: two-module-wide columns
 * are visited right to left, skipping the vertical timing column (column 6),
 * and within each column the direction alternates upward/downward, going
 * bottom-to-top first. Column pairs are (size-1, size-2), (size-3, size-4), ...
 * and the timing column is stepped over by shifting the right edge from 6 to 5.
 *
 * We record the bit in `bitMask` at the same time: the bit mask is what lets
 * the frame generator re-colour a cached symbol in place without re-running
 * this traversal (see qr/render.ts).
 */
export function placeData(m: QrMatrix, codewords: Uint8Array, totalBits: number): void {
  const size = m.size;
  const mods = m.modules;
  const mask = m.bitMask;
  const func = m.isFunction;

  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing pattern
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const i = idx(size, x, y);
        if (func[i]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
        }
        bitIndex++;
        mask[i] = bit;
        mods[i] = bit;
      }
    }
  }
}

/** The eight data masks of ISO/IEC 18004 table 10. */
export function maskBit(pattern: number, x: number, y: number): number {
  switch (pattern) {
    case 0:
      return (x + y) % 2 === 0 ? 1 : 0;
    case 1:
      return y % 2 === 0 ? 1 : 0;
    case 2:
      return x % 3 === 0 ? 1 : 0;
    case 3:
      return (x + y) % 3 === 0 ? 1 : 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0 ? 1 : 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0 ? 1 : 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0 ? 1 : 0;
    case 7:
      return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0 ? 1 : 0;
    default:
      throw new RangeError(`Mask pattern must be 0..7, got ${pattern}`);
  }
}

/**
 * XOR the data modules with a mask pattern. Function modules are untouched.
 * Returns the darkest module count, which the N4 penalty needs.
 */
export function applyMask(m: QrMatrix, pattern: number): number {
  const size = m.size;
  const mods = m.modules;
  const func = m.isFunction;
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!func[i] && maskBit(pattern, x, y)) mods[i] ^= 1;
      if (mods[i]) dark++;
    }
  }
  return dark;
}

/**
 * Mask evaluation score (ISO/IEC 18004 7.8.3). Four penalty rules:
 *
 *   N1 = 3   runs of 5+ identical modules in a row/column: 3 + (run - 5)
 *   N2 = 3   each 2x2 block of identical modules: 3
 *   N3 = 40  each 1:1:3:1:1 finder-like pattern with 4 light modules on
 *            either side: 40
 *   N4 = 10  deviation of the dark-module proportion from 50%, in 5% steps
 *
 * The mask with the lowest total score is used, because it produces the most
 * camera-friendly symbol (fewest confusing patterns and long runs).
 */
export function maskPenalty(m: QrMatrix, darkCount?: number): number {
  const size = m.size;
  const mods = m.modules;
  let score = 0;

  // --- N1: horizontal and vertical runs -------------------------------------
  const N1 = 3;
  const N2 = 3;
  const N3 = 40;
  const N4 = 10;

  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (mods[y * size + x] === mods[y * size + x - 1]) run++;
      else {
        if (run >= 5) score += N1 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += N1 + (run - 5);
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (mods[y * size + x] === mods[(y - 1) * size + x]) run++;
      else {
        if (run >= 5) score += N1 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += N1 + (run - 5);
  }

  // --- N2: 2x2 blocks --------------------------------------------------------
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = mods[y * size + x];
      if (a === mods[y * size + x + 1] && a === mods[(y + 1) * size + x] && a === mods[(y + 1) * size + x + 1]) {
        score += N2;
      }
    }
  }

  // --- N3: finder-like 1:1:3:1:1 patterns -----------------------------------
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const matches = (get: (i: number) => number, start: number, limit: number): boolean => {
    if (start + 6 >= limit) return false;
    for (let k = 0; k < 7; k++) if (get(start + k) !== pattern[k]) return false;
    return true;
  };
  for (let y = 0; y < size; y++) {
    const getRow = (i: number): number => mods[y * size + i];
    for (let x = 0; x + 6 < size; x++) {
      if (!matches(getRow, x, size)) continue;
      const before = x - 4 >= 0 && [0, 1, 2, 3].every((k) => getRow(x - 1 - k) === 0);
      const after = x + 10 < size && [0, 1, 2, 3].every((k) => getRow(x + 7 + k) === 0);
      if (before || after) score += N3;
    }
  }
  for (let x = 0; x < size; x++) {
    const getCol = (i: number): number => mods[i * size + x];
    for (let y = 0; y + 6 < size; y++) {
      if (!matches(getCol, y, size)) continue;
      const before = y - 4 >= 0 && [0, 1, 2, 3].every((k) => getCol(y - 1 - k) === 0);
      const after = y + 10 < size && [0, 1, 2, 3].every((k) => getCol(y + 7 + k) === 0);
      if (before || after) score += N3;
    }
  }

  // --- N4: dark proportion ---------------------------------------------------
  if (darkCount === undefined) {
    darkCount = 0;
    for (let i = 0; i < mods.length; i++) darkCount += mods[i];
  }
  const total = size * size;
  const percent = (darkCount * 100) / total;
  const lower = Math.floor(percent / 5);
  const upper = Math.ceil(percent / 5);
  score += N4 * Math.min(Math.abs(lower * 5 - 50) / 5, Math.abs(upper * 5 - 50) / 5);

  return score;
}
