import React, { useRef, useEffect, useState } from 'react';

export type OverlayTransform =
  | { kind: 'similarity'; params: [number, number, number, number] }
  | { kind: 'affine'; params: [number, number, number, number, number, number] }
  | null;

type Props = {
  imageData?: string | null | undefined;
  overlayTransform?: OverlayTransform;
  onClickImage?: (imgX: number, imgY: number) => void;
  onMouseMove?: (imgX: number, imgY: number) => void;
  points?: { x: number; y: number; color?: string }[];
  metersPerPixel?: number; // image m per px at current view (approx)
  showCrosshair?: boolean;
};

const Canvas: React.FC<Props> = ({ imageData, overlayTransform, onClickImage, onMouseMove, points = [], metersPerPixel, showCrosshair = false, ...props }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!imageData) { setImg(null); return; }
    const im = new Image();
    im.src = imageData;
    im.onload = () => setImg(im);
    return () => { setImg(null); };
  }, [imageData]);

  // Resize observer to maintain fitScale
  useEffect(() => {
    if (!img || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / img.width, rect.height / img.height);
      setFitScale(scale || 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = window.devicePixelRatio || 1;
    const parent = containerRef.current || canvas;
    const { width, height } = parent.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!img) return;

    const scale = fitScale * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (width - drawW) / 2 + pan.x;
    const offY = (height - drawH) / 2 + pan.y;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
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

    // crosshair and range rings
    if (showCrosshair && cursor) {
      const cx = cursor.x;
      const cy = cursor.y;
      const gap = 3; // px central gap half-length
      context.save();
      context.strokeStyle = 'rgba(255,255,255,0.9)';
      context.lineWidth = 1;
      // horizontal line with central gap
      context.beginPath();
      context.moveTo(0, cy);
      context.lineTo(cx - gap, cy);
      context.moveTo(cx + gap, cy);
      context.lineTo(width, cy);
      context.stroke();
      // vertical line with central gap
      context.beginPath();
      context.moveTo(cx, 0);
      context.lineTo(cx, cy - gap);
      context.moveTo(cx, cy + gap);
      context.lineTo(cx, height);
      context.stroke();
      // center dot
      context.fillStyle = 'rgba(255,255,255,0.9)';
      context.beginPath();
      context.arc(cx, cy, 1, 0, Math.PI * 2);
      context.fill();

      // rings
      if (metersPerPixel && scale > 0) {
        const mpp_screen = metersPerPixel / scale; // meters per screen px
        const steps = niceRings(mpp_screen);
        context.strokeStyle = 'rgba(255,255,255,0.6)';
        context.fillStyle = 'rgba(255,255,255,0.6)';
        context.font = '10px sans-serif';
        for (const m of steps) {
          const r = m / mpp_screen; // px
          if (r < 8) continue;
          context.beginPath();
          context.arc(cx, cy, r, 0, Math.PI * 2);
          context.stroke();
          context.fillText(`${m.toFixed(0)}m`, cx + r * 0.707 + 4, cy - r * 0.707 - 4);
        }
      }
      context.restore();
    }
  }, [img, points, overlayTransform, fitScale, zoom, pan, metersPerPixel, showCrosshair, cursor]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const parent = containerRef.current;
    if (!canvas || !parent) return;

    const rect = parent.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setCursor({ x: sx, y: sy });

    if (img && onMouseMove) {
      const scale = fitScale * zoom;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (parent.getBoundingClientRect().width - drawW) / 2 + pan.x;
      const offY = (parent.getBoundingClientRect().height - drawH) / 2 + pan.y;
      const ix = (sx - offX) / scale;
      const iy = (sy - offY) / scale;
      if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
        onMouseMove(ix, iy);
      }
    }

    if (dragging.current && lastPos.current) {
      const dx = e.clientX - (lastPos.current.x);
      const dy = e.clientY - (lastPos.current.y);
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    dragging.current = false;
    lastPos.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const parent = containerRef.current;
    if (!img || !parent) return;

    const rect = parent.getBoundingClientRect();
    const cursorPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const oldZoom = zoom;
    const newZoom = clamp(oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.1, 20);
    const oldScale = fitScale * oldZoom;
    const newScale = fitScale * newZoom;

    const drawW_old = img.width * oldScale;
    const drawH_old = img.height * oldScale;
    const offX_old = (rect.width - drawW_old) / 2 + pan.x;
    const offY_old = (rect.height - drawH_old) / 2 + pan.y;
    const imgX = (cursorPt.x - offX_old) / oldScale;
    const imgY = (cursorPt.y - offY_old) / oldScale;

    const drawW_new = img.width * newScale;
    const drawH_new = img.height * newScale;
    const offX_new_centered = (rect.width - drawW_new) / 2;
    const offY_new_centered = (rect.height - drawH_new) / 2;
    const newPanX = cursorPt.x - (offX_new_centered + imgX * newScale);
    const newPanY = cursorPt.y - (offY_new_centered + imgY * newScale);
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const parent = containerRef.current;
    if (!onClickImage || !img || !canvas || !parent) return;

    const scale = fitScale * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offX = (parent.getBoundingClientRect().width - drawW) / 2 + pan.x;
    const offY = (parent.getBoundingClientRect().height - drawH) / 2 + pan.y;

    const rect = parent.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ix = (sx - offX) / scale;
    const iy = (sy - offY) / scale;
    if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
      onClickImage(ix, iy);
    }
  };

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '100%' }}
      onMouseUp={handleMouseUp}
    >
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%', background: '#000', cursor: 'crosshair' }} 
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onClick={handleClick}
        {...props} 
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

function niceRings(mpp_screen: number): number[] {
  if (mpp_screen <= 0) return [];
  const target = 70 * mpp_screen;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const bases = [1, 2, 5].map(b => b * p);
  if (bases.length === 0) return [];
  const step = bases.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, bases[0] || 1);
  return [0.5, 1, 2.5, 5].map(k => k * step);
}
