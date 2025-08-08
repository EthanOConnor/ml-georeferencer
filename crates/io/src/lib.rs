use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::ImageFormat;
use proj::Proj;
use std::io::Cursor;

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
    let data_uri = format!("data:image/png;base64,{}", BASE64.encode(buffer.into_inner()));
    Ok(data_uri)
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
