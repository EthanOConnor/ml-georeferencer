import React, { useRef, useEffect, useState } from 'react';
import { log, isLoggingEnabled } from './logger';

export type OverlayTransform =
  | { kind: 'similarity'; params: [number, number, number, number] }
  | { kind: 'affine'; params: [number, number, number, number, number, number] }
  | null;

type Props = {
  imageData?: string | null | undefined;
  overlayTransform?: OverlayTransform;
  onImageClick?: (imgX: number, imgY: number) => void;
  onImageMouseMove?: (imgX: number, imgY: number) => void;
  view?: { zoom: number; pan: { x: number; y: number } } | undefined;
  onViewChange?: (v: { zoom: number; pan: { x: number; y: number } }) => void;
  onInteraction?: (e: { type: 'pan'; dx: number; dy: number } | { type: 'zoom'; factor: number; anchorCss: { x: number; y: number } }) => void;
  onInfo?: (info: { fitScale: number; size: { width: number; height: number }; imgSize: { width: number; height: number } }) => void;
  // When true, resets pan/zoom on each new image load
  resetOnImageLoad?: boolean;
  // Changing this number triggers a view reset (pan=0, zoom=1)
  resetKey?: number;
  points?: { x: number; y: number; color?: string }[];
  metersPerPixel?: number; // image m per px at current view (approx)
  dotRadiusPx?: number; // base radius in CSS px
  outlinePreview?: { x: number; y: number; color?: string } | undefined;
  onOutlineDrag?: (x: number, y: number) => void;
  onOutlineDrop?: (x: number, y: number) => void;
  labels?: { x: number; y: number; text: string; color?: string }[];
  showCrosshair?: boolean;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
};

const Canvas: React.FC<Props> = ({ imageData, overlayTransform, onImageClick, onImageMouseMove, view, onViewChange, onInteraction, onInfo, resetOnImageLoad = true, resetKey, points = [], metersPerPixel, dotRadiusPx, outlinePreview, onOutlineDrag, onOutlineDrop, labels = [], showCrosshair = false, canvasProps }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<OffscreenCanvas | null>(null);
  const offscreenCapableRef = useRef<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const lastCursorCssRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingOutlineRef = useRef<boolean>(false);
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
  const interactingRef = useRef(false);
  const interactTimer = useRef<number>(0 as unknown as number);
  const fpsElRef = useRef<HTMLDivElement | null>(null);
  const fpsLastRef = useRef(performance.now());
  const fpsFramesRef = useRef(0);
  const transientPtsRef = useRef<{ x: number; y: number; color?: string }[]>([]);

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
          if (onInfo && img) onInfo({ fitScale: Math.min(w / img.width, h / img.height) || 1, size: { width: w, height: h }, imgSize: { width: img.width, height: img.height } });
          return { width: w, height: h };
        }
        return prev;
      });
      const next = Math.min(w / img.width, h / img.height) || 1;
      setFitScale((prev) => {
        if (Math.abs(prev - next) > 1e-6) {
          log('fitScale_update', { prev, next });
          if (onInfo && img) onInfo({ fitScale: next, size: { width: w, height: h }, imgSize: { width: img.width, height: img.height } });
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

  // Apply external view control
  useEffect(() => {
    if (!view) return;
    const { zoom, pan } = view;
    const changed = Math.abs(zoomRef.current - zoom) > 1e-6 || Math.abs(panRef.current.x - pan.x) > 0.5 || Math.abs(panRef.current.y - pan.y) > 0.5;
    if (!changed) return;
    zoomRef.current = zoom;
    panRef.current = { x: pan.x, y: pan.y };
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.zoom, view?.pan.x, view?.pan.y]);

  // Reset view when a new image is loaded (opt-in)
  useEffect(() => {
    if (!img) return;
    if (resetOnImageLoad) {
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      log('view_reset_on_image', {});
      draw();
      // Clear transient after a fresh image load
      transientPtsRef.current = [];
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

    const w = containerSize.width, h = containerSize.height;
    let onscreen = canvas.getContext('2d')!;

    // Detect OffscreenCanvas 2D support once, with fallback
    if (offscreenCapableRef.current === null) {
      try {
        const OC = (window as any).OffscreenCanvas;
        if (!OC) offscreenCapableRef.current = false;
        else {
          const test = new OC(1, 1);
          const ctx = test.getContext('2d');
          offscreenCapableRef.current = !!ctx;
        }
      } catch {
        offscreenCapableRef.current = false;
      }
    }
    let hasOff = !!offscreenCapableRef.current;
    if (hasOff) {
      if (!offscreenRef.current || (offscreenRef.current.width !== w || offscreenRef.current.height !== h)) {
        offscreenRef.current = new (window as any).OffscreenCanvas(w, h);
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    } else {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (hasOff) {
      const ctx = (offscreenRef.current as OffscreenCanvas).getContext('2d');
      if (!ctx) {
        // Fallback if context creation fails at runtime
        hasOff = false;
        offscreenCapableRef.current = false;
        context = onscreen;
        canvas.width = w; canvas.height = h;
      } else {
        context = ctx;
      }
    } else {
      context = onscreen;
    }

    // Clear
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, w, h);

    if (!img) return;

    const zoom = zoomRef.current;
    const pan = panRef.current;
    const scale = fitScale * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (width - drawW) / 2 + pan.x;
    const offY = (height - drawH) / 2 + pan.y;

    // FPS tracking
    {
      const now = performance.now();
      fpsFramesRef.current += 1;
      if (now - fpsLastRef.current >= 500) {
        const fps = (fpsFramesRef.current * 1000) / (now - fpsLastRef.current);
        if (fpsElRef.current) fpsElRef.current.textContent = `${fps.toFixed(0)} fps`;
        fpsFramesRef.current = 0;
        fpsLastRef.current = now;
      }
    }

    // Debug logging removed for performance

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = qualityRef.current;
    context.drawImage(img, offX, offY, drawW, drawH);

    // Labels
    if (labels && labels.length > 0) {
      context.save();
      context.font = '12px ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = 'black';
      context.strokeStyle = 'white';
      context.lineWidth = 3;
      for (const lab of labels) {
        const sxCss = offX + lab.x * scale;
        const syCss = offY + lab.y * scale;
        const txt = lab.text;
        (context as CanvasRenderingContext2D).strokeText(txt, sxCss + 1, syCss - 4);
        (context as CanvasRenderingContext2D).fillText(txt, sxCss + 1, syCss - 4);
      }
      context.restore();
    }

    // Debug probe removed for performance

    // Constant screen-size points with light de-clutter when extremely zoomed out
    const baseR = dotRadiusPx || 5; // CSS px
    const rCss = scale < 0.05 ? 2 : scale < 0.12 ? 3 : baseR;
    const rDev = rCss;
    let drawnCells: Set<string> | null = null;
    if (scale < 0.08) drawnCells = new Set<string>();
    const cell = rCss * 2.2; // CSS px grid for declutter

    for (const p of points) {
      const sxCss = offX + p.x * scale;
      const syCss = offY + p.y * scale;
      if (drawnCells) {
        const key = `${Math.round(sxCss / cell)}:${Math.round(syCss / cell)}`;
        if (drawnCells.has(key)) continue;
        drawnCells.add(key);
      }
      const sx = sxCss;
      const sy = syCss;
      context.fillStyle = p.color || '#ff375f';
      context.beginPath();
      context.arc(sx, sy, rDev, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.6)';
      context.stroke();
    }

    // transient points (immediate feedback), drawn last
    for (const p of transientPtsRef.current) {
      const sxCss = offX + p.x * scale;
      const syCss = offY + p.y * scale;
      const sx = sxCss;
      const sy = syCss;
      context.fillStyle = p.color || '#ff375f';
      context.beginPath();
      context.arc(sx, sy, rDev * 1.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.6)';
      context.stroke();
    }

    // outline preview (stroke only)
    if (outlinePreview) {
      const px = outlinePreview.x, py = outlinePreview.y;
      const sxCss = offX + px * scale;
      const syCss = offY + py * scale;
      const sx = sxCss;
      const sy = syCss;
      context.save();
      context.lineWidth = 2;
      context.strokeStyle = outlinePreview.color || '#ffffff';
      context.beginPath();
      context.arc(sx, sy, rDev * 1.2, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    // overlay transformed grid (optional)
    if (overlayTransform && !interactingRef.current) {
      context.save();
      context.strokeStyle = 'rgba(0, 200, 255, 0.6)';
      const spacingPx = Math.max(80, Math.min(drawW, drawH) / 6);
      const spacingImg = spacingPx / scale;
      for (let x = 0; x <= img.width; x += spacingImg) {
        const p0 = applyTransform(overlayTransform, [x, 0]);
        const p1 = applyTransform(overlayTransform, [x, img.height]);
        context.beginPath();
        const m0x = offX + p0[0] * scale;
        const m0y = offY + p0[1] * scale;
        const m1x = offX + p1[0] * scale;
        const m1y = offY + p1[1] * scale;
        context.moveTo(m0x, m0y);
        context.lineTo(m1x, m1y);
        context.stroke();
      }
      for (let y = 0; y <= img.height; y += spacingImg) {
        const p0 = applyTransform(overlayTransform, [0, y]);
        const p1 = applyTransform(overlayTransform, [img.width, y]);
        context.beginPath();
        const m0x = offX + p0[0] * scale;
        const m0y = offY + p0[1] * scale;
        const m1x = offX + p1[0] * scale;
        const m1y = offY + p1[1] * scale;
        context.moveTo(m0x, m0y);
        context.lineTo(m1x, m1y);
        context.stroke();
      }
      context.restore();
    }

    // Blit offscreen buffer to onscreen
    if (hasOff) {
      onscreen.setTransform(1, 0, 0, 1, 0, 0);
      onscreen.clearRect(0, 0, w, h);
      onscreen.drawImage(offscreenRef.current as any, 0, 0, w, h, 0, 0, w, h);
    }
  };

  // Prevent page scroll on wheel and perform zoom with a native (non-passive) listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (!img) return;
      const rect = el.getBoundingClientRect();
      const cursorPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheelAnchorRef.current = cursorPt as any;
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
          interactingRef.current = true;
          zoomRef.current = newZoom;
          panRef.current = { x: newPanX, y: newPanY };
          draw();
          if (onViewChange) onViewChange({ zoom: zoomRef.current, pan: { ...panRef.current } });
          if (onInteraction) onInteraction({ type: 'zoom', factor: accum, anchorCss: anchor });
          requestAnimationFrame(() => {
            qualityRef.current = 'high';
            if (interactTimer.current) cancelAnimationFrame(interactTimer.current);
            interactTimer.current = requestAnimationFrame(() => {
              interactingRef.current = false;
              draw();
            });
          });
        });
      }
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative as EventListener);
  }, [img, containerSize, fitScale, onViewChange, onInteraction]);

  // Redraw when inputs change; clear transient feedback once props likely reflect the state
  useEffect(() => {
    // Only clear transient/overlay after the point is reflected in props
    if (transientPtsRef.current.length) {
      const t = transientPtsRef.current[0];
      if (t) {
        const found = points.some(p => Math.abs(p.x - t.x) < 0.5 && Math.abs(p.y - t.y) < 0.5);
        if (found) {
          transientPtsRef.current = [];
        }
      }
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, points, overlayTransform, fitScale, containerSize]);

  // (removed duplicate draw effect; above effect handles redraws)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const parent = containerRef.current;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastCursorCssRef.current = { x: sx, y: sy };
    if (outlinePreview && img) {
      const { width, height } = containerSize;
      const scale = fitScale * zoomRef.current;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (width - drawW) / 2 + panRef.current.x;
      const offY = (height - drawH) / 2 + panRef.current.y;
      const sxCss = offX + outlinePreview.x * scale;
      const syCss = offY + outlinePreview.y * scale;
      const r = (dotRadiusPx || 5) * 1.6;
      const dist2 = (sx - sxCss) * (sx - sxCss) + (sy - syCss) * (sy - syCss);
      if (dist2 <= (r + 8) * (r + 8)) {
        draggingOutlineRef.current = true;
        dragMoved.current = false;
        return;
      }
    }
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
    lastCursorCssRef.current = { x: sx, y: sy };

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

    if (draggingOutlineRef.current && onOutlineDrag && img) {
      const { width, height } = containerSize;
      const scale = fitScale * zoomRef.current;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (width - drawW) / 2 + panRef.current.x;
      const offY = (height - drawH) / 2 + panRef.current.y;
      const ix = (sx - offX) / scale;
      const iy = (sy - offY) / scale;
      onOutlineDrag(ix, iy);
      return;
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
          interactingRef.current = true;
          if (qualityIdleTimer.current) cancelAnimationFrame(qualityIdleTimer.current);
          qualityIdleTimer.current = requestAnimationFrame(() => {
            // after a frame idle, lift quality (will be set to high on next draw idle pass)
            qualityRef.current = 'high';
            // allow grid again after brief idle
            if (interactTimer.current) cancelAnimationFrame(interactTimer.current);
            interactTimer.current = requestAnimationFrame(() => { interactingRef.current = false; draw(); });
          });
          panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
          log('pan_drag', { dx, dy, next: panRef.current });
          if (onViewChange) onViewChange({ zoom: zoomRef.current, pan: { ...panRef.current } });
          if (onInteraction) onInteraction({ type: 'pan', dx, dy });
          draw();
        }
      });
    }
  };

  const onPointerUp = () => {
    if (draggingOutlineRef.current && onOutlineDrop && img) {
      draggingOutlineRef.current = false;
      const { width, height } = containerSize;
      const scale = fitScale * zoomRef.current;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (width - drawW) / 2 + panRef.current.x;
      const offY = (height - drawH) / 2 + panRef.current.y;
      const { x: sx, y: sy } = lastCursorCssRef.current;
      const ix = (sx - offX) / scale;
      const iy = (sy - offY) / scale;
      onOutlineDrop(ix, iy);
      return;
    }
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
        interactingRef.current = true;
        zoomRef.current = newZoom;
        panRef.current = { x: newPanX, y: newPanY };
        draw();
        if (onViewChange) onViewChange({ zoom: zoomRef.current, pan: { ...panRef.current } });
        if (onInteraction) onInteraction({ type: 'zoom', factor: accum, anchorCss: anchor });
        // restore quality next frame
        requestAnimationFrame(() => {
          qualityRef.current = 'high';
          if (interactTimer.current) cancelAnimationFrame(interactTimer.current);
          interactTimer.current = requestAnimationFrame(() => { interactingRef.current = false; draw(); });
        });
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
    // Debug: log mapping details
    if (isLoggingEnabled()) {
      try {
        log('click_map', {
          dragSuppressed: false,
          sx: Math.round(sx), sy: Math.round(sy), ix, iy,
          offX: Math.round(offX), offY: Math.round(offY), scale,
          dpr: (window.devicePixelRatio || 1),
          hasOff: typeof (window as any).OffscreenCanvas !== 'undefined'
        });
      } catch {}
    }

    if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
      // Treat click as interaction for one frame (disable grid, lower smoothing)
      interactingRef.current = true;
      qualityRef.current = 'low';
      onImageClick(ix, iy);
      // Redraw, then restore quality next frame
      draw();
      requestAnimationFrame(() => { qualityRef.current = 'high'; interactingRef.current = false; draw(); });
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        overscrollBehavior: 'contain'
      }}
    >
      <div ref={fpsElRef as any} style={{ position: 'absolute', left: 6, top: 4, color: '#9cf', font: '11px system-ui', opacity: 0.8, pointerEvents: 'none' }}></div>
      {/* Overlay dot removed to simplify and avoid flicker; points render handles feedback */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', background: '#000', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
