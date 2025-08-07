import React, { useRef, useEffect } from 'react';

type Similarity = { type: 'similarity'; params: [number, number, number, number] };
type Affine = { type: 'affine'; params: [number, number, number, number, number, number] };
type OverlayTransform = Similarity | Affine | null;

type Props = {
  overlayTransform?: OverlayTransform;
};

const Canvas: React.FC<Props> = ({ overlayTransform, ...props }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    context.fillStyle = '#0b0b0b';
    context.fillRect(0, 0, width, height);

    // Base grid for reference
    context.strokeStyle = 'rgba(255,255,255,0.1)';
    drawGrid(context, width, height, 50);

    // Transformed grid
    if (overlayTransform) {
      context.strokeStyle = 'rgba(0, 200, 255, 0.9)';
      drawTransformedGrid(context, overlayTransform, width, height, 50);
    }
  }, [overlayTransform]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', background: '#000' }} {...props} />
}

export default Canvas;

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, spacing: number) {
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}

function drawTransformedGrid(
  ctx: CanvasRenderingContext2D,
  t: OverlayTransform,
  width: number,
  height: number,
  spacing: number
) {
  if (!t) return;
  // Vertical lines
  for (let x = 0; x <= width; x += spacing) {
    const p0 = applyTransform(t, [x, 0]);
    const p1 = applyTransform(t, [x, height]);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }
  // Horizontal lines
  for (let y = 0; y <= height; y += spacing) {
    const p0 = applyTransform(t, [0, y]);
    const p1 = applyTransform(t, [width, y]);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }
}

function applyTransform(t: OverlayTransform, p: [number, number]): [number, number] {
  if (!t) return p;
  const [x, y] = p;
  if (t.type === 'similarity') {
    const [s, theta, tx, ty] = t.params;
    const c = Math.cos(theta);
    const sgn = Math.sin(theta);
    return [s * (c * x - sgn * y) + tx, s * (sgn * x + c * y) + ty];
  }
  if (t.type === 'affine') {
    const [a, b, c, d, tx, ty] = t.params;
    return [a * x + b * y + tx, c * x + d * y + ty];
  }
  return p;
}
