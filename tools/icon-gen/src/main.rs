use image::{ImageBuffer, Rgba};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let size = 1024u32;
    let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(size, size);

    // Background gradient (navy -> purple)
    for y in 0..size {
        let t = y as f32 / (size - 1) as f32;
        let r = (60.0 + 80.0 * t) as u8;
        let g = (70.0 - 20.0 * t) as u8;
        let b = (110.0 + 80.0 * t) as u8;
        let color = Rgba([r, g, b, 255]);
        for x in 0..size {
            img.put_pixel(x, y, color);
        }
    }

    // Simple map pin: white circle + tail
    let cx = (size / 2) as i32;
    let cy = (size / 2) as i32;
    let radius = (size as f32 * 0.28) as i32;
    for y in 0..size as i32 {
        for x in 0..size as i32 {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                img.put_pixel(x as u32, y as u32, Rgba([250, 250, 250, 255]));
            }
        }
    }
    // Tail: triangle below the circle
    let tail_h = (size as f32 * 0.14) as i32;
    let tail_w = (size as f32 * 0.10) as i32;
    let base_y = cy + radius - (size as i32 * 2 / 100); // slight overlap
    for y in 0..tail_h {
        let y_pos = base_y + y;
        let t = y as f32 / tail_h as f32; // 0..1
        let half_w = (tail_w as f32 * (1.0 - t)) as i32;
        for x in (cx - half_w)..=(cx + half_w) {
            if y_pos >= 0 && y_pos < size as i32 && x >= 0 && x < size as i32 {
                img.put_pixel(x as u32, y_pos as u32, Rgba([250, 250, 250, 255]));
            }
        }
    }

    // Inner circle (hole) to stylize the pin
    let hole_r = (radius as f32 * 0.45) as i32;
    for y in 0..size as i32 {
        for x in 0..size as i32 {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= hole_r * hole_r {
                // blend to background by sampling bg color; approximated as mid gradient
                let t = (y as f32 / size as f32).clamp(0.0, 1.0);
                let r = (60.0 + 80.0 * t) as u8;
                let g = (70.0 - 20.0 * t) as u8;
                let b = (110.0 + 80.0 * t) as u8;
                img.put_pixel(x as u32, y as u32, Rgba([r, g, b, 255]));
            }
        }
    }

    let out = std::path::Path::new("apps/desktop/src-tauri/icons/mlg-icon.png");
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    img.save(out)?;
    println!("Wrote {}", out.display());
    Ok(())
}
