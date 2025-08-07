use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::ImageFormat;
use std::io::Cursor;

pub fn load_raster(path: &str) -> Result<String> {
    // Load raster and return as PNG data URI for UI display
    let img = image::open(path)?;
    let mut buffer = Cursor::new(Vec::new());
    img.write_to(&mut buffer, ImageFormat::Png)?;
    let data_uri = format!("data:image/png;base64,{}", BASE64.encode(buffer.into_inner()));
    Ok(data_uri)
}

pub fn load_mbtiles(path: &str) -> Result<()> {
    // ... implementation ...
    Ok(())
}

pub fn load_cog(path: &str) -> Result<()> {
    // ... implementation ...
    Ok(())
}

pub fn load_pdf(path: &str) -> Result<()> {
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
