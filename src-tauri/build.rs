fn main() {
    // The Dock and window icons are embedded at compile time; rebuild when the artwork changes.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
