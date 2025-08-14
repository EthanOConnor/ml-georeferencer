import React, { useRef, useEffect, useState } from 'react';
import { log } from './logger';

export type OverlayTransform =
  | { kind: 'similarity'; params: [number, number, number, number] }
  | { kind: 'affine'; params: [number, number, number, number, number, number] }
  | null;

type Props = {
  imageData?: string | null | undefined;
  overlayTransform?: OverlayTransform;
  onImageClick?: (imgX: number, imgY: number) => void;
  onImageMouseMove?: (imgX: number, imgY: number) => void;
  // When true, resets pan/zoom on each new image load
  resetOnImageLoad?: boolean;
  // Changing this number triggers a view reset (pan=0, zoom=1)
  resetKey?: number;
  points?: { x: number; y: number; color?: string }[];
  metersPerPixel?: number; // image m per px at current view (approx)
  showCrosshair?: boolean;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
};

const Canvas: React.FC<Props> = ({ imageData, overlayTransform, onImageClick, onImageMouseMove, resetOnImageLoad = true, resetKey, points = [], metersPerPixel, showCrosshair = false, canvasProps }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const dragging = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const panAccum = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const panRaf = useRef(0);
  const dragMoved = useRef(false);
  const qualityRef = useRef<'low' | 'high'>('high');
  const qualityIdleTimer = useRef<number>(0 as unknown as number);
  const wheelAccumRef = useRef(1);
  const wheelAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const wheelRaf = useRef(0);

  useEffect(() => {
    if (!imageData) { setImg(null); return; }
    const im = new Image();
    im.src = imageData;
    im.onload = () => { 
      log('image_onload', { w: im.width, h: im.height, src_len: (im.src||'').length });
      setImg(im);
    };
    return () => { setImg(null); };
  }, [imageData]);

  // Measure container size using client box; avoid feedback loops
  useEffect(() => {
    if (!img || !containerRef.current) return;
    const el = containerRef.current;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      const changed = (prev: typeof containerSize) => prev.width !== w || prev.height !== h;
      setContainerSize((prev) => {
        if (changed(prev)) {
          log('container_measure', { clientW: w, clientH: h, rectW: Math.round(rect.width), rectH: Math.round(rect.height) });
          return { width: w, height: h };
        }
        return prev;
      });
      const next = Math.min(w / img.width, h / img.height) || 1;
      setFitScale((prev) => {
        if (Math.abs(prev - next) > 1e-6) {
          log('fitScale_update', { prev, next });
          return next;
        }
        return prev;
      });
    };

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    // initial measure
    measure();
    return () => ro.disconnect();
  }, [img]);

  // Reset view when a new image is loaded (opt-in)
  useEffect(() => {
    if (!img) return;
    if (resetOnImageLoad) {
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      log('view_reset_on_image', {});
      draw();
    }
  }, [img?.src]);

  // External reset trigger
  useEffect(() => {
    if (resetKey === undefined) return;
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    log('view_reset_by_key', { resetKey });
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Drawing (on demand)
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = containerSize;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerSize.width, h = containerSize.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      log('canvas_resize_pixels', { cssW: w, cssH: h, dpr, pixelW: canvas.width, pixelH: canvas.height });
    }
    const context = canvas.getContext('2d')!;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);  // draw in CSS px space below
    context.clearRect(0, 0, width, height);

    if (!img) return;

    const zoom = zoomRef.current;
    const pan = panRef.current;
    const scale = fitScale * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (width - drawW) / 2 + pan.x;
    const offY = (height - drawH) / 2 + pan.y;

    // Throttled draw-state logging
    (function() {
      const now = performance.now();
      const last = (window as any).__dbg_last_draw_log || 0;
      if (now - last > 150) {
        (window as any).__dbg_last_draw_log = now;
        log('draw_state', { width, height, dpr, fitScale, zoom, pan, drawW: Math.round(drawW), drawH: Math.round(drawH), offX: Math.round(offX), offY: Math.round(offY) });
      }
    })();

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = qualityRef.current;
    context.drawImage(img, offX, offY, drawW, drawH);

    // points
    for (const p of points) {
      const sx = offX + p.x * scale;
      const sy = offY + p.y * scale;
      context.fillStyle = p.color || '#ff375f';
      context.beginPath();
      context.arc(sx, sy, 4, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.6)';
      context.stroke();
    }

    // overlay transformed grid (optional)
    if (overlayTransform) {
      context.save();
      context.strokeStyle = 'rgba(0, 200, 255, 0.6)';
      const spacingPx = Math.max(50, Math.min(drawW, drawH) / 10);
      const spacingImg = spacingPx / scale;
      for (let x = 0; x <= img.width; x += spacingImg) {
        const p0 = applyTransform(overlayTransform, [x, 0]);
        const p1 = applyTransform(overlayTransform, [x, img.height]);
        context.beginPath();
        context.moveTo(offX + p0[0] * scale, offY + p0[1] * scale);
        context.lineTo(offX + p1[0] * scale, offY + p1[1] * scale);
        context.stroke();
      }
      for (let y = 0; y <= img.height; y += spacingImg) {
        const p0 = applyTransform(overlayTransform, [0, y]);
        const p1 = applyTransform(overlayTransform, [img.width, y]);
        context.beginPath();
        context.moveTo(offX + p0[0] * scale, offY + p0[1] * scale);
        context.lineTo(offX + p1[0] * scale, offY + p1[1] * scale);
        context.stroke();
      }
      context.restore();
    }
  };

  // Redraw when static inputs change
  useEffect(() => { draw(); }, [img, points, overlayTransform, fitScale, containerSize]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    dragMoved.current = false;
    log('pointer_down', { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const parent = containerRef.current;
    if (!canvas || !parent) return;

    const rect = parent.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (img && onImageMouseMove) {
      const scale = fitScale * zoomRef.current;
      const { width, height } = containerSize;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (width - drawW) / 2 + panRef.current.x;
      const offY = (height - drawH) / 2 + panRef.current.y;
      const ix = (sx - offX) / scale;
      const iy = (sy - offY) / scale;
      if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
        onImageMouseMove(ix, iy);
      }
    }

    if (!dragging.current || !lastPos.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) dragMoved.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    panAccum.current.dx += dx;
    panAccum.current.dy += dy;
    if (!panRaf.current) {
      panRaf.current = requestAnimationFrame(() => {
        const { dx, dy } = panAccum.current;
        panAccum.current = { dx: 0, dy: 0 };
        panRaf.current = 0;
        if (dx !== 0 || dy !== 0) {
          // lower quality during motion
          qualityRef.current = 'low';
          if (qualityIdleTimer.current) cancelAnimationFrame(qualityIdleTimer.current);
          qualityIdleTimer.current = requestAnimationFrame(() => {
            // after a frame idle, lift quality (will be set to high on next draw idle pass)
            qualityRef.current = 'high';
          });
          panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
          log('pan_drag', { dx, dy, next: panRef.current });
          draw();
        }
      });
    }
  };

  const onPointerUp = () => {
    dragging.current = false;
    lastPos.current = null;
    log('pointer_up', {});
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const parent = containerRef.current;
    if (!img || !parent) return;

    const rect = parent.getBoundingClientRect();
    const cursorPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    wheelAnchorRef.current = cursorPt;
    // accumulate multiplicative factor
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    wheelAccumRef.current *= factor;
    if (!wheelRaf.current) {
      wheelRaf.current = requestAnimationFrame(() => {
        const { width, height } = containerSize;
        const oldZoom = zoomRef.current;
        const accum = wheelAccumRef.current;
        wheelAccumRef.current = 1;
        wheelRaf.current = 0;
        const newZoom = clamp(oldZoom * accum, 0.1, 20);
        const oldScale = fitScale * oldZoom;
        const newScale = fitScale * newZoom;
        const anchor = wheelAnchorRef.current || { x: width / 2, y: height / 2 };
        const drawW_old = img.width * oldScale;
        const drawH_old = img.height * oldScale;
        const offX_old = (width - drawW_old) / 2 + panRef.current.x;
        const offY_old = (height - drawH_old) / 2 + panRef.current.y;
        const imgX = (anchor.x - offX_old) / oldScale;
        const imgY = (anchor.y - offY_old) / oldScale;
        const drawW_new = img.width * newScale;
        const drawH_new = img.height * newScale;
        const offX_new_centered = (width - drawW_new) / 2;
        const offY_new_centered = (height - drawH_new) / 2;
        const newPanX = anchor.x - (offX_new_centered + imgX * newScale);
        const newPanY = anchor.y - (offY_new_centered + imgY * newScale);
        qualityRef.current = 'low';
        zoomRef.current = newZoom;
        panRef.current = { x: newPanX, y: newPanY };
        draw();
        // restore quality next frame
        requestAnimationFrame(() => { qualityRef.current = 'high'; });
      });
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragMoved.current) { dragMoved.current = false; return; }
    const canvas = canvasRef.current;
    const parent = containerRef.current;
    if (!onImageClick || !img || !canvas || !parent) return;

    const { width, height } = containerSize;
    const scale = fitScale * zoomRef.current;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (width - drawW) / 2 + panRef.current.x;
    const offY = (height - drawH) / 2 + panRef.current.y;

    const rect = parent.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ix = (sx - offX) / scale;
    const iy = (sy - offY) / scale;
    if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
      onImageClick(ix, iy);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%', background: '#000', touchAction: 'none' }} 
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={handleWheel}
        onClick={handleClick}
        {...canvasProps}
      />
    </div>
  );
}

export default Canvas;

function applyTransform(
  t: NonNullable<OverlayTransform>,
  p: [number, number]
): [number, number] {
  const [x, y] = p;
  if (t.kind === 'similarity') {
    const [s, theta, tx, ty] = t.params;
    const c = Math.cos(theta);
    const si = Math.sin(theta);
    return [s * (c * x - si * y) + tx, s * (si * x + c * y) + ty];
  }
  const [a, b, c, d, tx, ty] = t.params;
  return [a * x + b * y + tx, c * x + d * y + ty];
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

// crosshair/range rings removed for simplicity and performance
