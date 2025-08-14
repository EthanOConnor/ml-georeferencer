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
  const [mapCursor, setMapCursor] = useState<string>('');
  const [refCursor, setRefCursor] = useState<string>('');
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
      setMapCursor(`${x.toFixed(2)}, ${y.toFixed(2)} px`);
    });
  };
  const updateRefCursor = (coords: any) => {
    cancelAnimationFrame(refCursorRAF.current);
    refCursorRAF.current = requestAnimationFrame(() => {
      if (!coords) { setRefCursor(''); return; }
      const x = (coords as any).x ?? (Array.isArray(coords) ? coords[0] : undefined);
      const y = (coords as any).y ?? (Array.isArray(coords) ? coords[1] : undefined);
      if (x === undefined || y === undefined) { setRefCursor(''); return; }
      if (coordFormat === 'lonlat') setRefCursor(`${x.toFixed(6)}, ${y.toFixed(6)}`);
      else setRefCursor(`${x.toFixed(2)}, ${y.toFixed(2)}${coordFormat === 'utm' ? ' m' : ''}`);
    });
  };

  async function pickMap() {
    const path = await open({ multiple: false, filters: [{ name: 'TIFF', extensions: ['tif', 'tiff'] }] });
    if (typeof path === 'string') {
      setMapPath(path);
      await invoke('set_map_path', { path });
      const data: string = await invoke('load_raster_data', { path });
      setMapImg(data);
    }
  }
  async function pickReference() {
    const path = await open({ multiple: false, filters: [{ name: 'TIFF', extensions: ['tif', 'tiff'] }] });
    if (typeof path === 'string') {
      setRefPath(path);
      await invoke('set_reference_path', { path });
      const data: string = await invoke('load_raster_data', { path });
      setRefImg(data);
    }
  }

  const [suggestedCrs, setSuggestedCrs] = useState<any | null>(null);
  const [refMetersPerPixel, setRefMetersPerPixel] = useState<number | null>(null);

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
    // recompute formatted pairs on coordFormat/constraints changes
    async function recompute() {
      const out: Record<number, { src: string; dst: string }> = {};
      for (const c of constraints) {
        if (coordFormat === 'pixels') {
          out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}` };
        } else {
          try {
            let conv: any;
            if (coordFormat === 'utm') {
              conv = await invoke('pixel_to_projected', { policy: datumPolicy, u: c.dst[0], v: c.dst[1] });
            } else {
              conv = await invoke('pixel_to', { u: c.dst[0], v: c.dst[1], mode: coordFormat });
            }
            const a = conv as [number, number] | null;
            if (a) {
              const fmt = coordFormat === 'lonlat' ? `${a[0].toFixed(6)}, ${a[1].toFixed(6)}` : `${a[0].toFixed(2)}, ${a[1].toFixed(2)}`;
              out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: fmt };
            } else {
              out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
            }
          } catch (e) {
            out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
          }
        }
      }
      setFormattedPairs(out);
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
          showCrosshair
          resetOnImageLoad={zoomToFitOnLoad}
          resetKey={resetKeyMap}
          onImageMouseMove={(x, y) => {
            updateMapCursor(x, y);
          }}
          canvasProps={{ onContextMenu: (e) => { e.preventDefault(); if (pendingSrc) setPendingSrc(null); } }}
          onImageClick={(x, y) => {
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
            } else {
              setPendingSrc([x, y]);
            }
          }}
          points={[
            ...(pendingSrc ? [{ x: pendingSrc[0], y: pendingSrc[1], color: '#ff375f' }] : []),
            ...constraints.map((p) => ({ x: p.src[0], y: p.src[1], color: '#ffd60a' })),
          ]}
        />
        <Canvas
          imageData={refImg || undefined}
          metersPerPixel={refMetersPerPixel || 0}
          showCrosshair
          resetOnImageLoad={zoomToFitOnLoad}
          resetKey={resetKeyRef}
          onImageMouseMove={async (x, y) => {
            rightLast.current = { x, y };
            cancelAnimationFrame(rightMoveRAF.current);
            rightMoveRAF.current = requestAnimationFrame(async () => {
              const last = rightLast.current;
              if (!last) return;
              try {
                const coords = await invoke('pixel_to', { u: last.x, v: last.y, mode: coordFormat });
                updateRefCursor(coords);
              } catch (e) {
                // ignore
              }
            });
          }}
          canvasProps={{ onContextMenu: (e) => { e.preventDefault(); if (pendingSrc) setPendingSrc(null); } }}
          onImageClick={(x, y) => {
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
            }
          }}
          points={constraints.map((p) => ({ x: p.dst[0], y: p.dst[1], color: '#64d2ff' }))}
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
        <span style={{ marginLeft: 'auto' }}><strong>Map</strong>: {mapCursor || '—'}</span>
        <span><strong>Ref</strong>: {refCursor || '—'}</span>
        {isDev && lastLogPath && <span style={{ marginLeft: 12, opacity: 0.7 }}>Log: {lastLogPath}</span>}
      </div>
    </div>
  );
}

export default App;
