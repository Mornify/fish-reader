fn main() {
    println!("cargo:rerun-if-changed=../.env");

    // Finder-launched macOS apps do not inherit the project shell environment
    // and cannot reliably locate the repository's `.env` at runtime. Embed the
    // ignored local key in personal release builds while still allowing a
    // runtime environment variable to override it.
    if let Ok(contents) = std::fs::read_to_string("../.env") {
        if let Some(api_key) = contents.lines().find_map(|line| {
            let (name, value) = line.split_once('=')?;
            (name.trim() == "FISH_API_KEY")
                .then(|| value.trim())
                .filter(|value| !value.is_empty())
        }) {
            println!("cargo:rustc-env=FISH_API_KEY={api_key}");
        }
    }

    tauri_build::build()
}
