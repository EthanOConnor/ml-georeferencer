use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::ImageFormat;
use proj::Proj;
use std::io::Cursor;
use std::path::Path; // kept for potential future use; ignore if unused

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Georef {
    pub affine: [f64; 6],
    pub wkt: Option<String>,
}

/// Read world file and optional PRJ file for a reference image.
pub fn read_georeferencing(path_without_ext: &str) -> Result<Georef> {
    use std::fs::read_to_string;
    use std::path::PathBuf;
    let affine = read_world_file(path_without_ext)?;
    let mut prj = PathBuf::from(path_without_ext);
    prj.set_extension("prj");
    let wkt = read_to_string(&prj).ok();
    Ok(Georef { affine, wkt })
}

/// Read georeferencing for an image path by trying common sidecar world/PRJ files,
/// then falling back to embedded GeoTIFF tags when the input is TIFF.
/// Returns Ok(Some(Georef)) on success, Ok(None) if nothing found.
pub fn read_georeferencing_for_image(image_path: &str) -> Result<Option<Georef>> {
    if let Some(aff) = read_world_file_for_image(image_path)? {
        let wkt = read_prj_for_image(image_path);
        return Ok(Some(Georef { affine: aff, wkt }));
    }
    // Fallback: TIFF/GeoTIFF tags
    let ext = Path::new(image_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if ext == "tif" || ext == "tiff" {
        if let Some(g) = read_geotiff_georeferencing(image_path)? {
            return Ok(Some(g));
        }
    }
    Ok(None)
}

/// Try common world-file sidecar names for a given raster path.
/// Returns Ok(Some([a,b,d,e,c,f])) when a usable world file is found.
pub fn read_world_file_for_image(image_path: &str) -> Result<Option<[f64; 6]>> {
    use std::fs::read_to_string;
    let path = Path::new(image_path);
    let stem = path.with_extension("");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let mut candidates: Vec<String> = Vec::new();
    // Extension-specific world file mappings
    match ext.as_str() {
        "tif" | "tiff" => candidates.push("tfw".into()),
        "jpg" | "jpeg" => {
            candidates.push("jgw".into());
            candidates.push("j2w".into());
        }
        "png" => candidates.push("pgw".into()),
        "gif" => candidates.push("gfw".into()),
        "bmp" => candidates.push("bpw".into()),
        _ => {}
    }
    candidates.push("wld".into()); // generic fallback
    for wext in candidates {
        let mut cand = stem.clone();
        cand.set_extension(&wext);
        if let Ok(s) = read_to_string(&cand) {
            let mut vals = [0.0f64; 6];
            for (i, line) in s.lines().enumerate().take(6) {
                vals[i] = line.trim().parse::<f64>()?;
            }
            return Ok(Some(vals));
        }
    }
    Ok(None)
}

/// Try to read a sidecar PRJ file (`.prj`) next to the image.
pub fn read_prj_for_image(image_path: &str) -> Option<String> {
    use std::fs::read_to_string;
    let base = Path::new(image_path).with_extension("");
    let candidates = ["prj", "PRJ", "Prj", "wkt", "WKT"];
    for ext in candidates.iter() {
        let mut cand = base.clone();
        cand.set_extension(ext);
        if let Ok(s) = read_to_string(&cand) {
            return Some(s);
        }
    }
    None
}

/// Attempt to read GeoTIFF georeferencing directly from a TIFF file.
/// Returns Ok(Some(Georef)) if tags are found and parsed, Ok(None) otherwise.
pub fn read_geotiff_georeferencing(tiff_path: &str) -> Result<Option<Georef>> {
    use tiff::decoder::Decoder;
    use tiff::tags::Tag;
    let mut dec = match Decoder::new(std::fs::File::open(tiff_path)?) {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };
    // Read tags we care about: ModelTransformation (34264), ModelPixelScale (33550), ModelTiepoint (33922)
    // tiff crate exposes GeoTIFF tags as Tag variants in newer versions; fall back to numeric if missing.
    fn read_f64_vec(dec: &mut Decoder<std::fs::File>, tag: Tag) -> Option<Vec<f64>> {
        // Try best-effort: not all tiff versions expose this; ignore errors.
        dec.get_tag_f64_vec(tag).ok()
    }
    // Try transformation first
    let transform = read_f64_vec(&mut dec, Tag::Unknown(34264));
    if let Some(m) = transform {
        if m.len() == 16 {
            // Row-major 4x4
            let a = m[0];
            let b = m[1];
            let d = m[4];
            let e = m[5];
            let c = m[3];
            let f = m[7];
            let wkt = geotiff_epsg(&mut dec);
            return Ok(Some(Georef {
                affine: [a, b, d, e, c, f],
                wkt,
            }));
        }
    }
    let scale = read_f64_vec(&mut dec, Tag::Unknown(33550));
    let tie = read_f64_vec(&mut dec, Tag::Unknown(33922));
    if let (Some(scale), Some(tie)) = (scale, tie) {
        if scale.len() >= 2 && tie.len() >= 6 {
            let sx = scale[0];
            let sy = scale[1];
            // Use the first tiepoint (I,J,K -> X,Y,Z)
            let i = tie[0];
            let j = tie[1];
            let _k = tie[2];
            let x = tie[3];
            let y = tie[4];
            // Construct world file style affine: X = A*px + B*py + C; Y = D*px + E*py + F
            // No rotation: A = sx; E = -sy; B=D=0
            let a = sx;
            let e = -sy;
            let b = 0.0;
            let d = 0.0;
            // Tiepoint maps pixel (i,j) to world (x,y): so C = x - A*i - B*j; F = y - D*i - E*j
            let mut c = x - a * i - b * j;
            let mut f = y - d * i - e * j;
            // Adjust for PixelIsArea (default) vs PixelIsPoint using GeoKey 1025.
            match geotiff_raster_type(&mut dec) {
                Some(2) => { /* PixelIsPoint: tiepoint defined at pixel center; no shift */ }
                _ => {
                    // PixelIsArea or unknown: shift world file origin to pixel centers
                    c += 0.5 * a;
                    f += 0.5 * e;
                }
            }
            let wkt = geotiff_epsg(&mut dec);
            return Ok(Some(Georef {
                affine: [a, b, d, e, c, f],
                wkt,
            }));
        }
    }
    Ok(None)
}

/// Extract an EPSG code from GeoTIFF GeoKeyDirectory (34735) and return a CRS identifier
/// string suitable for PROJ (e.g., "EPSG:32633"). Best-effort; returns None if unavailable.
fn geotiff_epsg(dec: &mut tiff::decoder::Decoder<std::fs::File>) -> Option<String> {
    use tiff::tags::Tag;
    // GeoKeyDirectoryTag (34735) contains u16 values with a 4-value header and 4-value entries.
    let dir = dec.get_tag_u16_vec(Tag::Unknown(34735)).ok()?;
    if dir.len() < 4 {
        return None;
    }
    let num_keys = dir[3] as usize;
    // Entries start at index 4, each 4 u16s: key_id, tiff_tag_location, count, value_offset
    if dir.len() < 4 + num_keys * 4 {
        return None;
    }
    let mut epsg: Option<u16> = None;
    for i in 0..num_keys {
        let base = 4 + i * 4;
        let key_id = dir[base];
        let tiff_loc = dir[base + 1];
        let _count = dir[base + 2];
        let value_off = dir[base + 3];
        // Prefer ProjectedCSTypeGeoKey (3072), else GeographicTypeGeoKey (2048)
        if (key_id == 3072 || key_id == 2048) && tiff_loc == 0 {
            epsg = Some(value_off);
            break;
        }
    }
    epsg.map(|c| format!("EPSG:{}", c))
}

/// Extract GTRasterTypeGeoKey (1025). 1 = PixelIsArea (default), 2 = PixelIsPoint
fn geotiff_raster_type(dec: &mut tiff::decoder::Decoder<std::fs::File>) -> Option<u16> {
    use tiff::tags::Tag;
    let dir = dec.get_tag_u16_vec(Tag::Unknown(34735)).ok()?;
    if dir.len() < 4 {
        return None;
    }
    let num_keys = dir[3] as usize;
    if dir.len() < 4 + num_keys * 4 {
        return None;
    }
    for i in 0..num_keys {
        let base = 4 + i * 4;
        let key_id = dir[base];
        let tiff_loc = dir[base + 1];
        let value_off = dir[base + 3];
        if key_id == 1025 && tiff_loc == 0 {
            return Some(value_off);
        }
    }
    None
}

/// Convert a reference pixel coordinate to real-world coordinates using the
/// affine transform from the world file.
pub fn pixel_to_world(geo: &Georef, px: [f64; 2]) -> [f64; 2] {
    let [a, b, d, e, c, f] = geo.affine;
    let x = a * px[0] + b * px[1] + c;
    let y = d * px[0] + e * px[1] + f;
    [x, y]
}

/// Convert a reference pixel coordinate to a local meter-plane coordinate
/// relative to `origin_px`.
pub fn pixel_to_local_meters(
    geo: &Georef,
    px: [f64; 2],
    origin_px: [f64; 2],
) -> Result<Option<[f64; 2]>> {
    let world = pixel_to_world(geo, px);
    let origin_world = pixel_to_world(geo, origin_px);
    let wkt = match &geo.wkt {
        Some(w) => w,
        None => return Ok(None),
    };
    // Convert world coordinates to WGS84
    let to_wgs84 = Proj::new_known_crs(wkt, "EPSG:4326", None)?;
    let (lon, lat) = to_wgs84.convert((world[0], world[1]))?;
    let (origin_lon, origin_lat) = to_wgs84.convert((origin_world[0], origin_world[1]))?;
    // Build local azimuthal equidistant projection centered at origin
    let aeqd_def = format!("+proj=aeqd +lat_0={} +lon_0={}", origin_lat, origin_lon);
    let to_local = Proj::new_known_crs("EPSG:4326", &aeqd_def, None)?;
    let (x, y) = to_local.convert((lon, lat))?;
    Ok(Some([x, y]))
}

pub fn load_raster(path: &str) -> Result<String> {
    // Load raster and return as PNG data URI for UI display
    let img = image::open(path)?;
    let mut buffer = Cursor::new(Vec::new());
    img.write_to(&mut buffer, ImageFormat::Png)?;
    let data_uri = format!(
        "data:image/png;base64,{}",
        BASE64.encode(buffer.into_inner())
    );
    Ok(data_uri)
}

pub fn image_dimensions(path: &str) -> Result<(u32, u32)> {
    let img = image::image_dimensions(path)?;
    Ok(img)
}

pub fn load_mbtiles(_path: &str) -> Result<()> {
    // ... implementation ...
    Ok(())
}

pub fn load_cog(_path: &str) -> Result<()> {
    // ... implementation ...
    Ok(())
}

pub fn load_pdf(_path: &str) -> Result<()> {
    // ... implementation ...
    Ok(())
}

pub fn write_world_file(path_without_ext: &str, affine: [f64; 6]) -> Result<()> {
    use std::fs::write;
    use std::path::PathBuf;
    let mut out = String::new();
    // ESRI world file convention values per line: A B D E C F
    out.push_str(&format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n",
        affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]
    ));
    let mut tfw = PathBuf::from(path_without_ext);
    tfw.set_extension("tfw");
    write(tfw, out)?;
    Ok(())
}

pub fn read_world_file(path_without_ext: &str) -> Result<[f64; 6]> {
    use std::fs::read_to_string;
    use std::path::PathBuf;
    let mut tfw = PathBuf::from(path_without_ext);
    tfw.set_extension("tfw");
    let s = read_to_string(tfw)?;
    let mut vals = [0.0f64; 6];
    for (i, line) in s.lines().enumerate().take(6) {
        vals[i] = line.trim().parse::<f64>()?;
    }
    Ok(vals)
}

pub fn write_prj(path_without_ext: &str, wkt: &str) -> Result<()> {
    use std::fs::write;
    use std::path::PathBuf;
    let mut prj = PathBuf::from(path_without_ext);
    prj.set_extension("prj");
    write(prj, wkt.as_bytes())?;
    Ok(())
}
