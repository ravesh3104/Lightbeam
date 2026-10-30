/**
 * QrView.tsx - high-contrast, GPU-upscaled QR symbol renderer for the web.
 *
 * Instead of expanding every QR module into scale x scale pixels in JavaScript
 * (hundreds of thousands of pixel writes per frame), `QrCanvas` writes one pixel
 * per module into a reused `ImageData` buffer and lets CSS `image-rendering:
 * pixelated` upscale on the GPU. When a 2D canvas context is unavailable (such
 * as headless jsdom unit tests), `QrView` falls back seamlessly to an inline
 * `<svg>` built from `toSvgPath()` with `shapeRendering="crispEdges"`.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  moduleCountWithQuietZone,
  rasterizeRgba,
  toSvgPath,
  type EncodedSymbol,
  type RgbaImage,
} from '@lightbeam/core';

export class QrCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private currentWidth = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context unavailable');
    this.context = context;
  }

  draw(symbol: EncodedSymbol, quietZone = 4): void {
    const image = rasterizeRgba(symbol, { scale: 1, quietZone });
    if (this.currentWidth !== image.width || !this.imageData) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.currentWidth = image.width;
      this.imageData = this.context.createImageData(image.width, image.height);
    }
    this.imageData.data.set(image.data);
    this.context.putImageData(this.imageData, 0, 0);
  }
}

/** Integer nearest-neighbour upscaler for camera simulation and loopback tests. */
export function scaleRgbaImage(image: RgbaImage, scale: number): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const width = image.width * scale;
  const height = image.height * scale;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / scale);
      const srcOffset = (sy * image.width + sx) * 4;
      const dstOffset = (y * width + x) * 4;
      out[dstOffset] = image.data[srcOffset];
      out[dstOffset + 1] = image.data[srcOffset + 1];
      out[dstOffset + 2] = image.data[srcOffset + 2];
      out[dstOffset + 3] = image.data[srcOffset + 3];
    }
  }
  return { width, height, data: out };
}

export interface QrViewProps {
  symbol: EncodedSymbol;
  size?: number;
  quietZone?: number;
}

function isJsdomRuntime(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

function QrViewImpl({ symbol, size = 360, quietZone = 4 }: QrViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrCanvasRef = useRef<QrCanvas | null>(null);
  const [useSvgFallback, setUseSvgFallback] = useState(isJsdomRuntime);

  useEffect(() => {
    if (useSvgFallback || !canvasRef.current) return;
    try {
      if (!qrCanvasRef.current) {
        qrCanvasRef.current = new QrCanvas(canvasRef.current);
      }
      qrCanvasRef.current.draw(symbol, quietZone);
    } catch {
      setUseSvgFallback(true);
    }
  }, [symbol, quietZone, useSvgFallback]);

  const units = useMemo(() => moduleCountWithQuietZone(symbol, quietZone), [symbol, quietZone]);
  const svgPath = useMemo(
    () => (useSvgFallback ? toSvgPath(symbol, { quietZone }) : ''),
    [symbol, quietZone, useSvgFallback],
  );

  return (
    <div className="qr-canvas-frame" data-testid="qr-symbol" data-version={symbol.version}>
      {useSvgFallback ? (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${units} ${units}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`LightBeam QR frame (${symbol.size}x${symbol.size} modules)`}
        >
          <rect x={0} y={0} width={units} height={units} fill="#ffffff" />
          <path d={svgPath} fill="#000000" />
        </svg>
      ) : (
        <canvas
          ref={canvasRef}
          className="qr-canvas"
          style={{ width: `${size}px`, height: `${size}px` }}
          aria-label={`LightBeam QR frame (${symbol.size}x${symbol.size} modules)`}
        />
      )}
    </div>
  );
}

export const QrView = memo(QrViewImpl);
