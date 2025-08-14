import { jsx as _jsx } from "react/jsx-runtime";
import { useRef, useEffect, useState } from 'react';
import { log } from './logger';
const Canvas = ({ imageData, overlayTransform, onClickImage, onMouseMove, points = [], metersPerPixel, showCrosshair = false, ...props }) => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [img, setImg] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [fitScale, setFitScale] = useState(1);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [cursor, setCursor] = useState(null);
    const dragging = useRef(false);
    const lastPos = useRef(null);
    useEffect(() => {
        if (!imageData) {
            setImg(null);
            return;
        }
        const im = new Image();
        im.src = imageData;
        im.onload = () => {
            log('image_onload', { w: im.width, h: im.height, src_len: (im.src || '').length });
            setImg(im);
        };
        return () => { setImg(null); };
    }, [imageData]);
    // Measure container size using client box; avoid feedback loops
    useEffect(() => {
        if (!img || !containerRef.current)
            return;
        const el = containerRef.current;
        const measure = () => {
            const rect = el.getBoundingClientRect();
            const w = Math.max(1, el.clientWidth);
            const h = Math.max(1, el.clientHeight);
            const changed = (prev) => prev.width !== w || prev.height !== h;
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
    // Reset view when a new image is loaded
    useEffect(() => {
        if (!img)
            return;
        setZoom(1);
        setPan({ x: 0, y: 0 });
        log('view_reset_on_image', {});
    }, [img?.src]);
    // Drawing
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const { width, height } = containerSize;
        if (width === 0 || height === 0)
            return;
        const dpr = window.devicePixelRatio || 1;
        const w = containerSize.width, h = containerSize.height;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            log('canvas_resize_pixels', { cssW: w, cssH: h, dpr, pixelW: canvas.width, pixelH: canvas.height });
        }
        const context = canvas.getContext('2d');
        context.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px space below
        context.clearRect(0, 0, width, height);
        if (!img)
            return;
        const scale = fitScale * zoom;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const offX = (width - drawW) / 2 + pan.x;
        const offY = (height - drawH) / 2 + pan.y;
        // Throttled draw-state logging
        (function () {
            const now = performance.now();
            const last = window.__dbg_last_draw_log || 0;
            if (now - last > 150) {
                window.__dbg_last_draw_log = now;
                log('draw_state', { width, height, dpr, fitScale, zoom, pan, drawW: Math.round(drawW), drawH: Math.round(drawH), offX: Math.round(offX), offY: Math.round(offY) });
            }
        })();
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
            const gap = 3;
            context.save();
            context.strokeStyle = 'rgba(255,255,255,0.9)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(0, cy);
            context.lineTo(cx - gap, cy);
            context.moveTo(cx + gap, cy);
            context.lineTo(width, cy);
            context.stroke();
            context.beginPath();
            context.moveTo(cx, 0);
            context.lineTo(cx, cy - gap);
            context.moveTo(cx, cy + gap);
            context.lineTo(cx, height);
            context.stroke();
            context.fillStyle = 'rgba(255,255,255,0.9)';
            context.beginPath();
            context.arc(cx, cy, 1, 0, Math.PI * 2);
            context.fill();
            if (metersPerPixel && scale > 0) {
                const mpp_screen = metersPerPixel / scale;
                const steps = niceRings(mpp_screen);
                context.strokeStyle = 'rgba(255,255,255,0.6)';
                context.fillStyle = 'rgba(255,255,255,0.6)';
                context.font = '10px sans-serif';
                for (const m of steps) {
                    const r = m / mpp_screen;
                    if (r < 8)
                        continue;
                    context.beginPath();
                    context.arc(cx, cy, r, 0, Math.PI * 2);
                    context.stroke();
                    context.fillText(`${m.toFixed(0)}m`, cx + r * 0.707 + 4, cy - r * 0.707 - 4);
                }
            }
            context.restore();
        }
    }, [img, points, overlayTransform, fitScale, zoom, pan, metersPerPixel, showCrosshair, cursor, containerSize]);
    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
        log('pointer_down', { x: e.clientX, y: e.clientY });
    };
    const onPointerMove = (e) => {
        const canvas = canvasRef.current;
        const parent = containerRef.current;
        if (!canvas || !parent)
            return;
        const rect = parent.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        setCursor({ x: sx, y: sy });
        if (!dragging.current) {
            // log cursor without spamming: every ~300ms
            const now = performance.now();
            const last = window.__dbg_last_cursor_log || 0;
            if (now - last > 300) {
                window.__dbg_last_cursor_log = now;
                log('cursor_move', { sx: Math.round(sx), sy: Math.round(sy) });
            }
        }
        if (img && onMouseMove) {
            const scale = fitScale * zoom;
            const { width, height } = containerSize;
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const offX = (width - drawW) / 2 + pan.x;
            const offY = (height - drawH) / 2 + pan.y;
            const ix = (sx - offX) / scale;
            const iy = (sy - offY) / scale;
            if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
                onMouseMove(ix, iy);
            }
        }
        if (!dragging.current || !lastPos.current)
            return;
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };
        setPan(p => { const np = { x: p.x + dx, y: p.y + dy }; log('pan_drag', { dx, dy, next: np }); return np; });
    };
    const onPointerUp = () => {
        dragging.current = false;
        lastPos.current = null;
        log('pointer_up', {});
    };
    const handleWheel = (e) => {
        e.preventDefault();
        const parent = containerRef.current;
        if (!img || !parent)
            return;
        const rect = parent.getBoundingClientRect();
        const { width, height } = containerSize;
        const cursorPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const oldZoom = zoom;
        const newZoom = clamp(oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.1, 20);
        const oldScale = fitScale * oldZoom;
        const newScale = fitScale * newZoom;
        const drawW_old = img.width * oldScale;
        const drawH_old = img.height * oldScale;
        const offX_old = (width - drawW_old) / 2 + pan.x;
        const offY_old = (height - drawH_old) / 2 + pan.y;
        const imgX = (cursorPt.x - offX_old) / oldScale;
        const imgY = (cursorPt.y - offY_old) / oldScale;
        const drawW_new = img.width * newScale;
        const drawH_new = img.height * newScale;
        const offX_new_centered = (width - drawW_new) / 2;
        const offY_new_centered = (height - drawH_new) / 2;
        const newPanX = cursorPt.x - (offX_new_centered + imgX * newScale);
        const newPanY = cursorPt.y - (offY_new_centered + imgY * newScale);
        log('wheel_zoom', { deltaY: e.deltaY, oldZoom, newZoom, oldScale, newScale, imgX, imgY, newPanX: Math.round(newPanX), newPanY: Math.round(newPanY) });
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    };
    const handleClick = (e) => {
        if (lastPos.current)
            return; // Prevent click after pan
        const canvas = canvasRef.current;
        const parent = containerRef.current;
        if (!onClickImage || !img || !canvas || !parent)
            return;
        const { width, height } = containerSize;
        const scale = fitScale * zoom;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const offX = (width - drawW) / 2 + pan.x;
        const offY = (height - drawH) / 2 + pan.y;
        const rect = parent.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const ix = (sx - offX) / scale;
        const iy = (sy - offY) / scale;
        if (ix >= 0 && iy >= 0 && ix <= img.width && iy <= img.height) {
            onClickImage(ix, iy);
        }
    };
    return (_jsx("div", { ref: containerRef, style: {
            width: '100%',
            height: '100%',
            overflow: 'hidden'
        }, children: _jsx("canvas", { ref: canvasRef, style: { width: '100%', height: '100%', background: '#000', cursor: 'crosshair', touchAction: 'none' }, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp, onWheel: handleWheel, onClick: handleClick, ...props }) }));
};
export default Canvas;
function applyTransform(t, p) {
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
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function niceRings(mpp_screen) {
    if (mpp_screen <= 0)
        return [];
    const target = 70 * mpp_screen;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const bases = [1, 2, 5].map(b => b * p);
    if (bases.length === 0)
        return [];
    const step = bases.reduce((best, b) => Math.abs(b - target) < Math.abs(best - target) ? b : best, bases[0] || 1);
    return [0.5, 1, 2.5, 5].map(k => k * step);
}
