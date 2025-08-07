use clap::Parser;

/// A simple CLI for the ML-assisted georeferencer
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    // Placeholder for CLI arguments
}

fn main() {
    let _args = Args::parse();
    println!("ML-Assisted Georeferencer CLI v{}", env!("CARGO_PKG_VERSION"));
}
