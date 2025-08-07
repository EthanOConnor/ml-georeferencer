import { useEffect, useMemo, useState } from 'react';
import Canvas, { OverlayTransform } from './Canvas';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';

function App() {
  const [mapPath, setMapPath] = useState<string | null>(null);
  const [refPath, setRefPath] = useState<string | null>(null);
  const [mapImg, setMapImg] = useState<string | null>(null);
  const [refImg, setRefImg] = useState<string | null>(null);
  const [constraints, setConstraints] = useState<{ id: number; src: [number, number]; dst: [number, number]; weight: number }[]>([]);
  const [pendingSrc, setPendingSrc] = useState<[number, number] | null>(null);
  const [solution, setSolution] = useState<{ method: 'similarity' | 'affine'; t: OverlayTransform; rmse: number; p90: number } | null>(null);

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

  async function addPair(src: [number, number], dst: [number, number]) {
    const c = { PointPair: { id: Date.now(), src, dst, weight: 1.0 } } as const;
    const list = (await invoke('add_constraint', { c })) as any[];
    const pairs = list.filter((x) => 'PointPair' in x).map((x) => x.PointPair);
    setConstraints(pairs);
  }

  async function solve(method: 'similarity' | 'affine') {
    const [stack, metrics] = (await invoke('solve_global', { method })) as [any, { rmse: number; p90_error: number }];
    const top = stack.transforms?.[0];
    if (top?.Similarity && method === 'similarity') {
      setSolution({ method, t: { kind: 'similarity', params: top.Similarity.params }, rmse: metrics.rmse, p90: metrics.p90_error });
    } else if (top?.Affine && method === 'affine') {
      setSolution({ method, t: { kind: 'affine', params: top.Affine.params }, rmse: metrics.rmse, p90: metrics.p90_error });
    }
  }

  async function exportWorld() {
    if (!mapPath || !solution) return;
    const base = mapPath.replace(/\.[^.]+$/, '');
    await invoke('export_world_file', { pathWithoutExt: base, method: solution.method });
    alert('World file written next to map');
  }

  return (
    <div className="container">
      <div className="canvas-container">
        <Canvas
          imageData={mapImg || undefined}
          overlayTransform={solution?.t || null}
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
        <h3>Pairs ({constraints.length})</h3>
        <ol style={{ maxHeight: 200, overflow: 'auto' }}>
          {constraints.map((c) => (
            <li key={c.id}>src {c.src.map((v) => v.toFixed(1)).join(', ')} → dst {c.dst.map((v) => v.toFixed(1)).join(', ')}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default App;
