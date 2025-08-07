import React, { useRef, useEffect, useState } from 'react';

export type OverlayTransform =
  | { kind: 'similarity'; params: [number, number, number, number] }
  | { kind: 'affine'; params: [number, number, number, number, number, number] }
  | null;

type Props = {
  imageData?: string | null;
  overlayTransform?: OverlayTransform;
  onClickImage?: (imgX: number, imgY: number) => void;
  points?: { x: number; y: number; color?: string }[];
};

const Canvas: React.FC<Props> = ({ imageData, overlayTransform, onClickImage, points = [], ...props }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!imageData) { setImg(null); return; }
    const im = new Image();
    im.src = imageData;
    im.onload = () => setImg(im);
    return () => { setImg(null); };
  }, [imageData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw image to fit canvas preserving aspect
    if (img) {
      const scale = Math.min(width / img.width, height / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (width - drawW) / 2;
      const offY = (height - drawH) / 2;
      context.drawImage(img, offX, offY, drawW, drawH);

      // draw points
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

      // overlay transformed grid in image space if available
      if (overlayTransform) {
        context.save();
        context.strokeStyle = 'rgba(0, 200, 255, 0.8)';
        const spacing = Math.max(50, Math.min(drawW, drawH) / 10);
        // vertical grid lines in image pixels
        for (let x = 0; x <= img.width; x += spacing/scale) {
          const p0 = applyTransform(overlayTransform, [x, 0]);
          const p1 = applyTransform(overlayTransform, [x, img.height]);
          context.beginPath();
          context.moveTo(offX + p0[0] * scale, offY + p0[1] * scale);
          context.lineTo(offX + p1[0] * scale, offY + p1[1] * scale);
          context.stroke();
        }
        for (let y = 0; y <= img.height; y += spacing/scale) {
          const p0 = applyTransform(overlayTransform, [0, y]);
          const p1 = applyTransform(overlayTransform, [img.width, y]);
          context.beginPath();
          context.moveTo(offX + p0[0] * scale, offY + p0[1] * scale);
          context.lineTo(offX + p1[0] * scale, offY + p1[1] * scale);
          context.stroke();
        }
        context.restore();
      }

      // attach click handler to map canvas coords to image coords
      const handle = (ev: MouseEvent) => {
        if (!onClickImage) return;
        const rect = canvas.getBoundingClientRect();
        const cx = ev.clientX - rect.left;
        const cy = ev.clientY - rect.top;
        // invert the fit transform
        const scale = Math.min(width / img.width, height / img.height);
        const offX = (width - img.width * scale) / 2;
        const offY = (height - img.height * scale) / 2;
        const ix = (cx - offX) / scale;
        const iy = (cy - offY) / scale;
        if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
          onClickImage(ix, iy);
        }
      };
      canvas.addEventListener('click', handle);
      return () => canvas.removeEventListener('click', handle);
    }
  }, [img, overlayTransform, points, onClickImage]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', background: '#000' }} {...props} />
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
