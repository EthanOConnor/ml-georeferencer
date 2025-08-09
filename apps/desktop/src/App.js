import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import Canvas from './Canvas';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
function App() {
    const [mapPath, setMapPath] = useState(null);
    const [refPath, setRefPath] = useState(null);
    const [mapImg, setMapImg] = useState(null);
    const [refImg, setRefImg] = useState(null);
    const [constraints, setConstraints] = useState([]);
    const [pendingSrc, setPendingSrc] = useState(null);
    const [solution, setSolution] = useState(null);
    const [residuals, setResiduals] = useState([]);
    const [globalOnly, setGlobalOnly] = useState(true);
    const [errorUnit, setErrorUnit] = useState('pixels');
    const [mapScale, setMapScale] = useState(null);
    const [referenceGeoref, setReferenceGeoref] = useState(null);
    const [coordFormat, setCoordFormat] = useState('pixels');
    const [formattedPairs, setFormattedPairs] = useState({});
    const [datumPolicy, setDatumPolicy] = useState('WGS84');
    const [cursorCoords, setCursorCoords] = useState('');
    async function pickMap() {
        const path = await open({ multiple: false, filters: [{ name: 'TIFF', extensions: ['tif', 'tiff'] }] });
        if (typeof path === 'string') {
            setMapPath(path);
            await invoke('set_map_path', { path });
            const data = await invoke('load_raster_data', { path });
            setMapImg(data);
        }
    }
    async function pickReference() {
        const path = await open({ multiple: false, filters: [{ name: 'TIFF', extensions: ['tif', 'tiff'] }] });
        if (typeof path === 'string') {
            setRefPath(path);
            await invoke('set_reference_path', { path });
            const data = await invoke('load_raster_data', { path });
            setRefImg(data);
        }
    }
    const [suggestedCrs, setSuggestedCrs] = useState(null);
    const [refMetersPerPixel, setRefMetersPerPixel] = useState(null);
    useEffect(() => {
        async function fetchGeoref() {
            if (refPath) {
                try {
                    const geo = await invoke('get_reference_georef');
                    setReferenceGeoref(geo);
                    const crs = await invoke('suggest_output_epsg', { policy: datumPolicy });
                    setSuggestedCrs(crs);
                    const mpp = await invoke('metric_scale_at', { u: 0, v: 0 });
                    setRefMetersPerPixel(mpp?.mpp || null);
                }
                catch (error) {
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
            const out = {};
            for (const c of constraints) {
                if (coordFormat === 'pixels') {
                    out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}` };
                }
                else {
                    try {
                        let conv;
                        if (coordFormat === 'utm') {
                            conv = await invoke('pixel_to_projected', { policy: datumPolicy, u: c.dst[0], v: c.dst[1] });
                        }
                        else {
                            conv = await invoke('pixel_to', { u: c.dst[0], v: c.dst[1], mode: coordFormat });
                        }
                        const a = conv;
                        if (a) {
                            const fmt = coordFormat === 'lonlat' ? `${a[0].toFixed(6)}, ${a[1].toFixed(6)}` : `${a[0].toFixed(2)}, ${a[1].toFixed(2)}`;
                            out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: fmt };
                        }
                        else {
                            out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
                        }
                    }
                    catch (e) {
                        out[c.id] = { src: `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, dst: 'n/a' };
                    }
                }
            }
            setFormattedPairs(out);
        }
        recompute();
    }, [coordFormat, constraints, datumPolicy]);
    async function addPair(src, dst) {
        const c = {
            PointPair: {
                id: Date.now(),
                src,
                dst,
                dst_real: null,
                dst_local: null,
                weight: 1.0,
            },
        };
        const list = (await invoke('add_constraint', { c }));
        const pairs = list.filter((x) => 'PointPair' in x).map((x) => x.PointPair);
        setConstraints(pairs);
    }
    async function solve(method) {
        try {
            const [stack, metrics] = (await invoke('solve_global', {
                method,
                errorUnit,
                mapScale,
            }));
            const top = stack.transforms?.[0];
            if (top?.Similarity && method === 'similarity') {
                setSolution({ method, t: { kind: 'similarity', params: top.Similarity.params }, rmse: metrics.rmse, p90: metrics.p90_error });
            }
            else if (top?.Affine && method === 'affine') {
                setSolution({ method, t: { kind: 'affine', params: top.Affine.params }, rmse: metrics.rmse, p90: metrics.p90_error });
            }
            setResiduals(metrics.residuals_by_id.map(([id, r]) => ({ id, r })));
        }
        catch (error) {
            console.error("Error solving:", error);
            alert(`Error solving: ${error}`);
        }
    }
    async function exportWorld() {
        if (!mapPath || !solution)
            return;
        const base = mapPath.replace(/\.[^.]+$/, '');
        await invoke('export_world_file', { pathWithoutExt: base, method: solution.method });
        alert('World file written next to map');
    }
    async function copyProj() {
        if (!solution)
            return;
        const proj = await invoke('get_proj_string', { method: solution.method });
        await navigator.clipboard.writeText(proj);
        alert('PROJ string copied to clipboard');
    }
    return (_jsxs("div", { className: "container", children: [_jsxs("div", { className: "canvas-container", children: [_jsx(Canvas, { imageData: mapImg, overlayTransform: solution?.t || null, showCrosshair: true, onMouseMove: async (x, y) => {
                            const coords = await invoke('pixel_to', { u: x, v: y, mode: 'pixel' });
                            setCursorCoords(coords ? `${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}` : '');
                        }, onClickImage: (x, y) => {
                            if (pendingSrc) {
                                addPair(pendingSrc, [x, y]);
                                setPendingSrc(null);
                            }
                            else {
                                setPendingSrc([x, y]);
                            }
                        }, points: [
                            ...(pendingSrc ? [{ x: pendingSrc[0], y: pendingSrc[1], color: '#ff375f' }] : []),
                            ...constraints.map((p) => ({ x: p.src[0], y: p.src[1], color: '#ffd60a' })),
                        ] }), _jsx(Canvas, { imageData: refImg || undefined, metersPerPixel: refMetersPerPixel || 0, showCrosshair: true, onMouseMove: async (x, y) => {
                            const coords = await invoke('pixel_to', { u: x, v: y, mode: coordFormat });
                            setCursorCoords(coords ? `${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}` : '');
                        }, onClickImage: (x, y) => {
                            if (pendingSrc) {
                                addPair(pendingSrc, [x, y]);
                                setPendingSrc(null);
                            }
                        }, points: constraints.map((p) => ({ x: p.dst[0], y: p.dst[1], color: '#64d2ff' })) })] }), _jsxs("div", { className: "side-panel", children: [_jsx("h2", { children: "Controls" }), _jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 8 }, children: [_jsx("button", { onClick: pickMap, children: "Load Map TIFF" }), _jsx("button", { onClick: pickReference, children: "Load Reference TIFF" })] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 8 }, children: [_jsx("button", { onClick: () => solve('similarity'), disabled: constraints.length < 2, children: "Solve Similarity" }), _jsx("button", { onClick: () => solve('affine'), disabled: constraints.length < 3, children: "Solve Affine" }), _jsx("button", { onClick: exportWorld, disabled: !solution, children: "Export World File" }), _jsx("button", { onClick: copyProj, disabled: !solution, children: "Copy PROJ" })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("label", { htmlFor: "errorUnit", children: "Error Units:" }), _jsxs("select", { id: "errorUnit", value: errorUnit, onChange: (e) => setErrorUnit(e.target.value), children: [_jsx("option", { value: "pixels", children: "Pixels" }), _jsx("option", { value: "meters", children: "Meters" }), _jsx("option", { value: "mapmm", children: "Map Millimeters" })] }), errorUnit === 'mapmm' && (_jsx("input", { type: "number", placeholder: "Map Scale (e.g., 10000)", value: mapScale || '', onChange: (e) => setMapScale(e.target.value ? parseFloat(e.target.value) : null) }))] }), _jsx("div", { style: { marginBottom: 8 }, children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: globalOnly, onChange: (e) => setGlobalOnly(e.target.checked) }), " Global only"] }) }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("label", { htmlFor: "coordFormat", children: "Coordinate format:" }), ' ', _jsxs("select", { id: "coordFormat", value: coordFormat, onChange: (e) => setCoordFormat(e.target.value), children: [_jsx("option", { value: "pixels", children: "Pixels" }), _jsx("option", { value: "lonlat", children: "Lon/Lat (deg)" }), _jsx("option", { value: "local_m", children: "Local meters (AEQD)" }), _jsx("option", { value: "utm", children: "Projected meters (UTM)" })] })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("label", { htmlFor: "datumPolicy", children: "Output CRS Policy:" }), _jsxs("select", { id: "datumPolicy", value: datumPolicy, onChange: (e) => setDatumPolicy(e.target.value), children: [_jsx("option", { value: "WGS84", children: "WGS 84" }), _jsx("option", { value: "NAD83_2011", children: "NAD83(2011)" })] })] }), _jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: "Status: " }), constraints.length < 2 && 'Add ≥2 pairs for similarity', constraints.length >= 2 && constraints.length < 3 && 'Add ≥3 for affine', constraints.length >= 3 && 'Ready to solve'] }), solution && (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: "Solution:" }), " ", solution.method, " | RMSE ", solution.rmse.toFixed(3), " | P90 ", solution.p90.toFixed(3)] })), referenceGeoref && (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("h3", { children: "Reference Georeferencing" }), _jsxs("p", { children: ["Affine: [", referenceGeoref.affine.map(a => a.toFixed(3)).join(', '), "]"] }), suggestedCrs && _jsxs("p", { children: ["Suggested output CRS: ", suggestedCrs.name] }), referenceGeoref.wkt && _jsxs("p", { children: ["CRS (PRJ): ", referenceGeoref.wkt.substring(0, 120), referenceGeoref.wkt.length > 120 ? '…' : ''] })] })), residuals.length > 0 && (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("h3", { children: "Residuals" }), _jsx("table", { children: _jsx("tbody", { children: residuals.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: r.id }), _jsx("td", { children: r.r.toFixed(2) })] }, r.id))) }) })] })), _jsxs("h3", { children: ["Pairs (", constraints.length, ")"] }), _jsx("ol", { style: { maxHeight: 200, overflow: 'auto' }, children: constraints.map((c) => (_jsxs("li", { children: ["src ", formattedPairs[c.id]?.src || `${c.src[0].toFixed(1)}, ${c.src[1].toFixed(1)}`, " \u2192 dst ", formattedPairs[c.id]?.dst || `${c.dst[0].toFixed(1)}, ${c.dst[1].toFixed(1)}`] }, c.id))) })] }), _jsxs("div", { className: "status-bar", children: [referenceGeoref?.wkt ? `Ref CRS: ${referenceGeoref.wkt.substring(0, 60)}...` : 'No Ref CRS', _jsx("span", { style: { marginLeft: 'auto' }, children: cursorCoords })] })] }));
}
export default App;
