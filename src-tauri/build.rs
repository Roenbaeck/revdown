fn main() {
    tauri_build::build();

    // Tauri enables APIs from Common Controls v6. Its application manifest is
    // embedded in the packaged binary, but Cargo's Windows test harness needs
    // the same dependency or it resolves those APIs against v5 and fails before
    // running any tests with STATUS_ENTRYPOINT_NOT_FOUND.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:\
             type='win32' name='Microsoft.Windows.Common-Controls' \
             version='6.0.0.0' processorArchitecture='*' \
             publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
}
