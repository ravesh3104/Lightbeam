// Scratch: how big is the SVG path the native renderer rebuilds each frame?
import { encodeText, toSvgPath } from '@lightbeam/core';
for (const v of [1, 5, 15, 27, 40]) {
  const symbol = encodeText('x'.repeat(10), { minVersion: v, maxVersion: v, ecLevel: 'L' });
  const path = toSvgPath(symbol);
  let dark = 0;
  for (const m of symbol.modules) dark += m;
  console.log(
    `v${v} size=${symbol.size} modules=${symbol.size ** 2} dark=${dark} pathLen=${path.length} ` +
      `len/size=${(path.length / symbol.size).toFixed(2)} len/modules=${(path.length / symbol.size ** 2).toFixed(3)}`,
  );
}
