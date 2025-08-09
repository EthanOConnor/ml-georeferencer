import { useEffect, useMemo, useState } from 'react';
import Canvas, { OverlayTransform } from './Canvas';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

function App() {
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
      <div className="canvas-container">
        <Canvas
          imageData={mapImg}
          overlayTransform={solution?.t || null}
          showCrosshair
          onMouseMove={async (x, y) => {
            const coords = await invoke('pixel_to', { u: x, v: y, mode: 'pixel' });
            setCursorCoords(coords ? `${(coords as any).x.toFixed(2)}, ${(coords as any).y.toFixed(2)}` : '');
          }}
          onClickImage={(x, y) => {
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
          onMouseMove={async (x, y) => {
            const coords = await invoke('pixel_to', { u: x, v: y, mode: coordFormat });
            setCursorCoords(coords ? `${(coords as any).x.toFixed(2)}, ${(coords as any).y.toFixed(2)}` : '');
          }}
          onClickImage={(x, y) => {
            if (pendingSrc) {
              addPair(pendingSrc, [x, y]);
              setPendingSrc(null);
            }
          }}
          points={constraints.map((p) => ({ x: p.dst[0], y: p.dst[1], color: '#64d2ff' }))}
        />
      </div>
      <div className="side-panel">
        <h2>Controls</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={pickMap}>Load Map TIFF</button>
          <button onClick={pickReference}>Load Reference TIFF</button>
        </div>
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
        <ol style={{ maxHeight: 200, overflow: 'auto' }}>
          {constraints.map((c) => (
            <li key={c.id}>src {formattedPairs[c.id]?.src || `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`} → dst {formattedPairs[c.id]?.dst || `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}`}</li>
          ))}
        </ol>
      </div>
      <div className="status-bar">
        {referenceGeoref?.wkt ? `Ref CRS: ${referenceGeoref.wkt.substring(0, 60)}...` : 'No Ref CRS'}
        <span style={{ marginLeft: 'auto' }}>{cursorCoords}</span>
      </div>
    </div>
  );
}

export default App;
