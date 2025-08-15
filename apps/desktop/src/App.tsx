import { useEffect, useMemo, useState, useRef } from 'react';
import Canvas, { OverlayTransform } from './Canvas';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { downloadLogs, clearLogs, log, setLoggingEnabled, isLoggingEnabled, getLogs } from './logger';

function App() {
  const buildTag = useMemo(() => new Date().toISOString(), []);
  const isDev = (import.meta as any)?.env?.DEV === true;
  const [mapPath, setMapPath] = useState<string | null>(null);
  const [refPath, setRefPath] = useState<string | null>(null);
  const [mapImg, setMapImg] = useState<string | null>(null);
  const [refImg, setRefImg] = useState<string | null>(null);
  const [constraints, setConstraints] = useState<{ id: number; src: [number, number]; dst: [number, number]; weight: number }[]>([]);
  const [pendingSrc, setPendingSrc] = useState<[number, number] | null>(null);
  const [solution, setSolution] = useState<{ method: 'similarity' | 'affine'; t: OverlayTransform; rmse: number; p90: number } | null>(null);
  const [residuals, setResiduals] = useState<{ id: number; r: number }[]>([]);
  const [autoSolve, setAutoSolve] = useState(true);
  const [globalOnly, setGlobalOnly] = useState(true);
  const [errorUnit, setErrorUnit] = useState<'pixels' | 'meters' | 'mapmm'>('pixels');
  const [mapScale, setMapScale] = useState<number | null>(null);
  const [referenceGeoref, setReferenceGeoref] = useState<{ affine: number[]; wkt: string | null } | null>(null);
  const [coordFormat, setCoordFormat] = useState<'pixels' | 'lonlat' | 'local_m' | 'utm'>('pixels');
  const [formattedPairs, setFormattedPairs] = useState<Record<number, { src: string; dst: string }>>({});
  const [datumPolicy, setDatumPolicy] = useState<'WGS84' | 'NAD83_2011'>('WGS84');
  const [cursorCoords, setCursorCoords] = useState<string>('');
  const coordUpdateRef = useRef(0);
  // New UI/UX states
  const [zoomToFitOnLoad, setZoomToFitOnLoad] = useState(true);
  const [resetKeyMap, setResetKeyMap] = useState(0);
  const [resetKeyRef, setResetKeyRef] = useState(0);
  const mapCursorEl = useRef<HTMLSpanElement>(null);
  const refCursorEl = useRef<HTMLSpanElement>(null);
  const rightMoveRAF = useRef(0);
  const rightLast = useRef<{ x: number; y: number } | null>(null);
  const [lastLogPath, setLastLogPath] = useState<string>('');

  // Global wheel observer to detect unintended wheel inputs
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const target = (e.target as HTMLElement)?.tagName || 'unknown';
      const cls = (e.target as HTMLElement)?.className || '';
      log('global_wheel', { deltaY: e.deltaY, target, cls });
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const updateCursorCoords = (coords: any) => {
    cancelAnimationFrame(coordUpdateRef.current);
    coordUpdateRef.current = requestAnimationFrame(() => {
        if (coords) {
            setCursorCoords(`${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}`);
        } else {
            setCursorCoords('');
        }
    });
  };

  // rAF throttled cursor setters
  const mapCursorRAF = useRef(0);
  const refCursorRAF = useRef(0);
  const updateMapCursor = (x: number, y: number) => {
    cancelAnimationFrame(mapCursorRAF.current);
    mapCursorRAF.current = requestAnimationFrame(() => {
      if (mapCursorEl.current) mapCursorEl.current.textContent = `${x.toFixed(2)}, ${y.toFixed(2)} px`;
    });
  };
  const updateRefCursor = (coords: any) => {
    cancelAnimationFrame(refCursorRAF.current);
    refCursorRAF.current = requestAnimationFrame(() => {
      if (!coords) { if (refCursorEl.current) refCursorEl.current.textContent = '—'; return; }
      const x = (coords as any).x ?? (Array.isArray(coords) ? coords[0] : undefined);
      const y = (coords as any).y ?? (Array.isArray(coords) ? coords[1] : undefined);
      if (x === undefined || y === undefined) { if (refCursorEl.current) refCursorEl.current.textContent = '—'; return; }
      if (refCursorEl.current) {
        if (coordFormat === 'lonlat') refCursorEl.current.textContent = `${x.toFixed(6)}, ${y.toFixed(6)}`;
        else refCursorEl.current.textContent = `${x.toFixed(2)}, ${y.toFixed(2)}${coordFormat === 'utm' ? ' m' : ''}`;
      }
    });
  };

  async function pickMap() {
    const path = await open({ multiple: false, filters: [
      { name: 'Raster', extensions: ['tif', 'tiff', 'png', 'jpg', 'jpeg'] }
    ] });
    if (typeof path === 'string') {
      setMapPath(path);
      await invoke('set_map_path', { path });
      const data: string = await invoke('load_raster_data', { path });
      setMapImg(data);
    }
  }
  async function pickReference() {
    const path = await open({ multiple: false, filters: [
      { name: 'Raster', extensions: ['tif', 'tiff', 'png', 'jpg', 'jpeg'] }
    ] });
    if (typeof path === 'string') {
      setRefPath(path);
      await invoke('set_reference_path', { path });
      const data: string = await invoke('load_raster_data', { path });
      setRefImg(data);
    }
  }

  const [suggestedCrs, setSuggestedCrs] = useState<any | null>(null);
  const [refMetersPerPixel, setRefMetersPerPixel] = useState<number | null>(null);
  const [lockViews, setLockViews] = useState(false);
  const [mapView, setMapView] = useState<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const [refView, setRefView] = useState<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const [dotRadius, setDotRadius] = useState<number>(5);
  const [refPreviewOverride, setRefPreviewOverride] = useState<{ x: number; y: number } | null>(null);
  const [activeView, setActiveView] = useState<'map' | 'ref' | null>(null);
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapInfoRef = useRef<{ fitScale: number; size: { width: number; height: number }; imgSize: { width: number; height: number } } | null>(null);
  const refInfoRef = useRef<{ fitScale: number; size: { width: number; height: number }; imgSize: { width: number; height: number } } | null>(null);

  useEffect(() => {
    async function fetchGeoref() {
      if (refPath) {
        try {
          const geo = await invoke('get_reference_georef');
          setReferenceGeoref(geo as { affine: number[]; wkt: string | null } | null);
          const crs = await invoke('suggest_output_epsg', { policy: datumPolicy });
          setSuggestedCrs(crs);
          const mpp = await invoke('metric_scale_at', { u: 0, v: 0 });
          setRefMetersPerPixel((mpp as any)?.mpp || null);
        } catch (error) {
          console.error("Error fetching georeference:", error);
          setReferenceGeoref(null);
          setSuggestedCrs(null);
        }
      }
    }
    fetchGeoref();
  }, [refPath, datumPolicy]);

  // Auto-enable view locking and rough alignment after first two pairs
  useEffect(() => {
    if (constraints.length >= 2 && !lockViews) {
      setLockViews(true);
      // Rough align: center both on their centroids and roughly match zooms by two-point scale
      const srcs = constraints.map(c => c.src);
      const dsts = constraints.map(c => c.dst);
      const srcCx = srcs.reduce((a, b) => a + b[0], 0) / srcs.length;
      const srcCy = srcs.reduce((a, b) => a + b[1], 0) / srcs.length;
      const dstCx = dsts.reduce((a, b) => a + b[0], 0) / dsts.length;
      const dstCy = dsts.reduce((a, b) => a + b[1], 0) / dsts.length;
      let s = 1;
      if (constraints.length >= 2) {
        const a = constraints[0];
        const b = constraints[1];
        if (a && b) {
          const ds = Math.hypot((b.src[0] - a.src[0]), (b.src[1] - a.src[1]));
          const dd = Math.hypot((b.dst[0] - a.dst[0]), (b.dst[1] - a.dst[1]));
          if (ds > 1e-6) s = dd / ds;
        }
      }
      const mi = mapInfoRef.current, ri = refInfoRef.current;
      if (mi && ri) {
        const scaleMap = mi.fitScale * 1;
        const scaleRef = ri.fitScale * 1;
        const zoomMap = 1;
        const zoomRef = (scaleMap * s) / (scaleRef || 1);
        const pmx = mi.size.width / 2 - ((mi.size.width - mi.imgSize.width * (mi.fitScale * zoomMap)) / 2 + srcCx * (mi.fitScale * zoomMap));
        const pmy = mi.size.height / 2 - ((mi.size.height - mi.imgSize.height * (mi.fitScale * zoomMap)) / 2 + srcCy * (mi.fitScale * zoomMap));
        const prx = ri.size.width / 2 - ((ri.size.width - ri.imgSize.width * (ri.fitScale * zoomRef)) / 2 + dstCx * (ri.fitScale * zoomRef));
        const pry = ri.size.height / 2 - ((ri.size.height - ri.imgSize.height * (ri.fitScale * zoomRef)) / 2 + dstCy * (ri.fitScale * zoomRef));
        setMapView({ zoom: zoomMap, pan: { x: pmx, y: pmy } });
        setRefView({ zoom: zoomRef, pan: { x: prx, y: pry } });
      }
    }
  }, [constraints, lockViews]);

  function zoomOtherView(
    which: 'map' | 'ref',
    factor: number,
    anchorCss: { x: number; y: number }
  ) {
    const otherInfo = which === 'map' ? refInfoRef.current : mapInfoRef.current;
    const otherView = which === 'map' ? refView : mapView;
    if (!otherInfo || !otherView) return;
    const { fitScale, size, imgSize } = otherInfo;
    const oldScale = fitScale * otherView.zoom;
    const newZoom = otherView.zoom * factor;
    const newScale = fitScale * newZoom;
    const drawW_old = imgSize.width * oldScale;
    const drawH_old = imgSize.height * oldScale;
    const offX_old = (size.width - drawW_old) / 2 + otherView.pan.x;
    const offY_old = (size.height - drawH_old) / 2 + otherView.pan.y;
    const imgX = (anchorCss.x - offX_old) / oldScale;
    const imgY = (anchorCss.y - offY_old) / oldScale;
    const drawW_new = imgSize.width * newScale;
    const drawH_new = imgSize.height * newScale;
    const offX_new_centered = (size.width - drawW_new) / 2;
    const offY_new_centered = (size.height - drawH_new) / 2;
    const newPanX = anchorCss.x - (offX_new_centered + imgX * newScale);
    const newPanY = anchorCss.y - (offY_new_centered + imgY * newScale);
    const next = { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
    if (which === 'map') setRefView(next); else setMapView(next);
  }

  // Mapping for preview on ref side
  function mapToRef(x: number, y: number): { x: number; y: number } | null {
    // Prefer full solution
    if (solution?.t) {
      if (solution.t.kind === 'similarity') {
        const [s, th, tx, ty] = solution.t.params;
        const c = Math.cos(th), si = Math.sin(th);
        return { x: s * (c * x - si * y) + tx, y: s * (si * x + c * y) + ty };
      }
      if (solution.t.kind === 'affine') {
        const [a, b, c, d, tx, ty] = solution.t.params;
        return { x: a * x + b * y + tx, y: c * x + d * y + ty };
      }
    }
    // Rough from first two pairs
    if (constraints.length >= 2) {
      const a = constraints[0];
      const b = constraints[1];
      if (!a || !b) return null;
      const vSx = b.src[0] - a.src[0];
      const vSy = b.src[1] - a.src[1];
      const vDx = b.dst[0] - a.dst[0];
      const vDy = b.dst[1] - a.dst[1];
      const angS = Math.atan2(vSy, vSx);
      const angD = Math.atan2(vDy, vDx);
      const th = angD - angS;
      const s = Math.hypot(vDx, vDy) / Math.max(1e-6, Math.hypot(vSx, vSy));
      const c = Math.cos(th), si = Math.sin(th);
      const tx = a.dst[0] - s * (c * a.src[0] - si * a.src[1]);
      const ty = a.dst[1] - s * (si * a.src[0] + c * a.src[1]);
      return { x: s * (c * x - si * y) + tx, y: s * (si * x + c * y) + ty };
    }
    return null;
  }

  // Auto-dump logs ~8s after a new image is selected, to capture self-pan (only when logging enabled)
  useEffect(() => {
    if (!mapImg && !refImg) return;
    if (!isLoggingEnabled()) return;
    const t = setTimeout(async () => {
      try {
        const payload = JSON.stringify({ when: new Date().toISOString(), note: 'auto-save after image load', logs: getLogs() });
        const path = (await invoke('save_debug_log', { data: payload, filename: null })) as string;
        console.info('Saved debug log to', path);
        setLastLogPath(path);
      } catch (e) {
        console.warn('Failed to save debug log', e);
      }
    }, 8000);
    return () => clearTimeout(t);
  }, [mapImg, refImg]);

  useEffect(() => {
    // recompute formatted pairs on coordFormat/constraints changes (batched)
    async function recompute() {
      const out: Record<number, { src: string; dst: string }> = {};
      if (constraints.length === 0) { setFormattedPairs(out); return; }
      if (coordFormat === 'pixels') {
        for (const c of constraints) {
          out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}` };
        }
        setFormattedPairs(out);
        return;
      }
      try {
        const pts = constraints.map(c => [c.dst[0], c.dst[1]]);
        let convs: any[];
        if (coordFormat === 'utm') {
          convs = await invoke('pixels_to_projected', { policy: datumPolicy, pts });
        } else {
          convs = await invoke('pixels_to', { mode: coordFormat, pts });
        }
        constraints.forEach((c, i) => {
          const r = convs[i];
          if (r && r.x != null && r.y != null) {
            const fmt = coordFormat === 'lonlat' ? `${r.x.toFixed(6)}, ${r.y.toFixed(6)}` : `${r.x.toFixed(2)}, ${r.y.toFixed(2)}`;
            out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: fmt };
          } else {
            out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
          }
        });
        setFormattedPairs(out);
      } catch (e) {
        for (const c of constraints) {
          out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
        }
        setFormattedPairs(out);
      }
    }
    recompute();
  }, [coordFormat, constraints, datumPolicy]);

  async function addPair(src: [number, number], dst: [number, number]) {
    const c = {
      PointPair: {
        id: Date.now(),
        src,
        dst,
        dst_real: null,
        dst_local: null,
        weight: 1.0,
      },
    } as const;
    const list = (await invoke('add_constraint', { c })) as any[];
    const pairs = list.filter((x) => 'PointPair' in x).map((x) => x.PointPair);
    setConstraints(pairs);
  }

  async function solve(method: 'similarity' | 'affine') {
    try {
      const [stack, metrics] = (await invoke('solve_global', {
        method,
        errorUnit,
        mapScale,
      })) as [
        any,
        { rmse: number; p90_error: number; residuals_by_id: [number, number][] }
      ];
      const top = stack.transforms?.[0];
      if (top?.Similarity && method === 'similarity') {
        setSolution({ method, t: { kind: 'similarity', params: top.Similarity.params }, rmse: metrics.rmse, p90: metrics.p90_error });
      } else if (top?.Affine && method === 'affine') {
        setSolution({ method, t: { kind: 'affine', params: top.Affine.params }, rmse: metrics.rmse, p90: metrics.p90_error });
      }
      setResiduals(metrics.residuals_by_id.map(([id, r]) => ({ id, r })));
    } catch (error) {
      console.error("Error solving:", error);
      alert(`Error solving: ${error}`);
    }
  }

  // Re-solve when error unit or mapScale changes so residuals reflect units
  useEffect(() => {
    if (solution) {
      solve(solution.method);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUnit, mapScale]);

  // Auto-solve with debounce when constraints change
  useEffect(() => {
    if (!autoSolve) return;
    const h = setTimeout(() => {
      if (constraints.length >= 3) solve('affine');
      else if (constraints.length >= 2) solve('similarity');
    }, 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraints, autoSolve]);

  async function exportWorld() {
    if (!mapPath || !solution) return;
    const base = mapPath.replace(/\.[^.]+$/, '');
    await invoke('export_world_file', { pathWithoutExt: base, method: solution.method });
    alert('World file written next to map');
  }

  async function copyProj() {
    if (!solution) return;
    const proj: string = await invoke('get_proj_string', { method: solution.method });
    await navigator.clipboard.writeText(proj);
    alert('PROJ string copied to clipboard');
  }

  return (
    <div className="container">
      <div className="canvas-container" style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
        <Canvas
          imageData={mapImg}
          overlayTransform={solution?.t || null}
          resetOnImageLoad={zoomToFitOnLoad}
          resetKey={resetKeyMap}
          dotRadiusPx={dotRadius}
          view={activeView === 'map' ? undefined : (mapView || undefined)}
          onViewChange={(v) => setMapView(v)}
          onInteraction={(e) => {
            setActiveView('map');
            if (activeTimer.current) clearTimeout(activeTimer.current);
            activeTimer.current = setTimeout(() => setActiveView(null), 120);
            if (!lockViews) return;
            if (e.type === 'pan') {
              setRefView(prev => prev ? { zoom: prev.zoom, pan: { x: prev.pan.x + e.dx, y: prev.pan.y + e.dy } } : prev);
            } else {
              zoomOtherView('map', e.factor, e.anchorCss);
            }
          }}
          onInfo={(info) => { mapInfoRef.current = info; }}
          onImageMouseMove={(x, y) => {
            updateMapCursor(x, y);
          }}
          canvasProps={{ onContextMenu: (e) => { e.preventDefault(); if (pendingSrc) setPendingSrc(null); } }}
          onImageClick={(x, y) => {
            console.debug('APP map onImageClick', { pendingBefore: pendingSrc, x, y });
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
            } else {
              setPendingSrc([x, y]);
            }
            queueMicrotask(() => console.debug('APP pendingSrc after microtask', { pendingAfter: pendingSrc }));
          }}
          points={[
            ...(pendingSrc ? [{ x: pendingSrc[0], y: pendingSrc[1], color: '#ff375f' }] : []),
            ...constraints.map((p) => ({ x: p.src[0], y: p.src[1], color: '#ffd60a' })),
          ]}
        />
        <Canvas
          imageData={refImg || undefined}
          metersPerPixel={refMetersPerPixel || 0}
          resetOnImageLoad={zoomToFitOnLoad}
          resetKey={resetKeyRef}
          dotRadiusPx={dotRadius}
          labels={constraints.map(c => {
            const r = residuals.find(x => x.id === c.id)?.r;
            return r != null ? { x: c.dst[0], y: c.dst[1], text: `${r.toFixed(2)}` } : { x: c.dst[0], y: c.dst[1], text: '' };
          })}
          view={activeView === 'ref' ? undefined : (refView || undefined)}
          onViewChange={(v) => setRefView(v)}
          onInteraction={(e) => {
            setActiveView('ref');
            if (activeTimer.current) clearTimeout(activeTimer.current);
            activeTimer.current = setTimeout(() => setActiveView(null), 120);
            if (!lockViews) return;
            if (e.type === 'pan') {
              setMapView(prev => prev ? { zoom: prev.zoom, pan: { x: prev.pan.x + e.dx, y: prev.pan.y + e.dy } } : prev);
            } else {
              zoomOtherView('ref', e.factor, e.anchorCss);
            }
          }}
          onInfo={(info) => { refInfoRef.current = info; }}
          onOutlineDrag={(x: number, y: number) => setRefPreviewOverride({ x, y })}
          onOutlineDrop={(x: number, y: number) => {
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
              setRefPreviewOverride(null);
            }
          }}
          onImageMouseMove={(() => {
            let lastTs = 0;
            return async (x: number, y: number) => {
              const now = performance.now();
              if (now - lastTs < 50) return; // throttle to ~20 Hz
              lastTs = now;
              try {
                const coords = await invoke('pixel_to', { u: x, v: y, mode: coordFormat });
                updateRefCursor(coords);
              } catch {}
            };
          })()}
          canvasProps={{ onContextMenu: (e) => { e.preventDefault(); if (pendingSrc) setPendingSrc(null); } }}
          onImageClick={(x, y) => {
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
            }
          }}
          points={constraints.map((p) => ({ x: p.dst[0], y: p.dst[1], color: '#64d2ff' }))}
          outlinePreview={pendingSrc ? (refPreviewOverride || (() => { const m = mapToRef(pendingSrc[0], pendingSrc[1]); return m ? { x: m.x, y: m.y, color: '#ffffff' } : undefined; })()) : undefined}
        />
      </div>
      <div className="side-panel">
        <h2>Controls {isDev && <small style={{ opacity: 0.6, fontWeight: 'normal' }}>(build {buildTag})</small>}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={pickMap}>Load Map TIFF</button>
          <button onClick={pickReference}>Load Reference TIFF</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <button onClick={() => { setResetKeyMap(k => k + 1); setResetKeyRef(k => k + 1); }}>Reset View</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={zoomToFitOnLoad} onChange={(e) => setZoomToFitOnLoad(e.target.checked)} /> Zoom to fit on load
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={lockViews} onChange={(e) => setLockViews(e.target.checked)} /> Lock views
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Dot size <input type="range" min={3} max={10} value={dotRadius} onChange={(e) => setDotRadius(parseInt(e.target.value))} />
          </label>
        </div>
        {isDev && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={() => { downloadLogs(); }}>Download Logs</button>
            <button onClick={() => { clearLogs(); }}>Clear Logs</button>
            <button onClick={() => { const en = !isLoggingEnabled(); setLoggingEnabled(en); }}>Toggle Logging</button>
            <button onClick={async () => {
              try {
                const payload = JSON.stringify({ when: new Date().toISOString(), note: 'manual save', logs: getLogs() });
                const path = (await invoke('save_debug_log', { data: payload, filename: null })) as string;
                setLastLogPath(path);
                alert(`Saved debug log to:\n${path}`);
              } catch (e) {
                alert(`Failed to save debug log: ${e}`);
              }
            }}>Save Logs</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => solve('similarity')} disabled={constraints.length < 2}>Solve Similarity</button>
          <button onClick={() => solve('affine')} disabled={constraints.length < 3}>Solve Affine</button>
          <button onClick={exportWorld} disabled={!solution}>Export World File</button>
          <button onClick={copyProj} disabled={!solution}>Copy PROJ</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
            <input type="checkbox" checked={autoSolve} onChange={(e) => setAutoSolve(e.target.checked)} /> Auto-solve
          </label>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="errorUnit">Error Units:</label>
          <select id="errorUnit" value={errorUnit} onChange={(e) => setErrorUnit(e.target.value as 'pixels' | 'meters' | 'mapmm')}>
            <option value="pixels">Pixels</option>
            <option value="meters">Meters</option>
            <option value="mapmm">Map Millimeters</option>
          </select>
          {errorUnit === 'mapmm' && (
            <input
              type="number"
              placeholder="Map Scale (e.g., 10000)"
              value={mapScale || ''}
              onChange={(e) => setMapScale(e.target.value ? parseFloat(e.target.value) : null)}
            />
          )}
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>
            <input type="checkbox" checked={globalOnly} onChange={(e) => setGlobalOnly(e.target.checked)} /> Global only
          </label>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="coordFormat">Coordinate format:</label>{' '}
          <select id="coordFormat" value={coordFormat} onChange={(e) => setCoordFormat(e.target.value as any)}>
            <option value="pixels">Pixels</option>
            <option value="lonlat">Lon/Lat (deg)</option>
            <option value="local_m">Local meters (AEQD)</option>
            <option value="utm">Projected meters (UTM)</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="datumPolicy">Output CRS Policy:</label>
          <select id="datumPolicy" value={datumPolicy} onChange={(e) => setDatumPolicy(e.target.value as any)}>
            <option value="WGS84">WGS 84</option>
            <option value="NAD83_2011">NAD83(2011)</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>Status: </strong>
          {constraints.length < 2 && 'Add ≥2 pairs for similarity'}
          {constraints.length >= 2 && constraints.length < 3 && 'Add ≥3 for affine'}
          {constraints.length >= 3 && 'Ready to solve'}
        </div>
        {solution && (
          <div style={{ marginBottom: 8 }}>
            <strong>Solution:</strong> {solution.method} | RMSE {solution.rmse.toFixed(3)} | P90 {solution.p90.toFixed(3)}
          </div>
        )}
        {referenceGeoref && (
          <div style={{ marginBottom: 8 }}>
            <h3>Reference Georeferencing</h3>
            <p>Affine: [{referenceGeoref.affine.map(a => a.toFixed(3)).join(', ')}]</p>
            {suggestedCrs && <p>Suggested output CRS: {suggestedCrs.name}</p>}
            {referenceGeoref.wkt && <p>CRS (PRJ): {referenceGeoref.wkt.substring(0, 120)}{referenceGeoref.wkt.length > 120 ? '…' : ''}</p>}
          </div>
        )}
        {residuals.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <h3>Residuals</h3>
            <table><tbody>
              {residuals.map((r) => (
                <tr key={r.id}><td>{r.id}</td><td>{r.r.toFixed(2)}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
        <h3>Pairs ({constraints.length})</h3>
        <ol style={{ maxHeight: 200, overflow: 'auto', paddingLeft: 16 }}>
          {constraints.map((c) => (
            <li key={c.id}
                onContextMenu={async (e) => { e.preventDefault(); try { const list = await invoke('delete_constraint', { id: c.id }); const pairs = (list as any[]).filter((x) => 'PointPair' in x).map((x) => x.PointPair); setConstraints(pairs); } catch (err) { console.warn(err); } }}>
              <span>src {formattedPairs[c.id]?.src || `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`} → dst {formattedPairs[c.id]?.dst || `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}`}</span>
              <button style={{ marginLeft: 8 }} title="Delete" onClick={async () => { try { const list = await invoke('delete_constraint', { id: c.id }); const pairs = (list as any[]).filter((x) => 'PointPair' in x).map((x) => x.PointPair); setConstraints(pairs); } catch (err) { console.warn(err); } }}>✕</button>
            </li>
          ))}
        </ol>
      </div>
      <div className="status-bar" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '0 8px' }}>
        <span style={{ opacity: 0.8 }}>{referenceGeoref?.wkt ? `Ref CRS: ${referenceGeoref.wkt.substring(0, 60)}...` : 'No Ref CRS'}</span>
        <span style={{ marginLeft: 'auto' }}><strong>Map</strong>: <span ref={mapCursorEl}>—</span></span>
        <span><strong>Ref</strong>: <span ref={refCursorEl}>—</span></span>
        {isDev && lastLogPath && <span style={{ marginLeft: 12, opacity: 0.7 }}>Log: {lastLogPath}</span>}
      </div>
    </div>
  );
}

export default App;
