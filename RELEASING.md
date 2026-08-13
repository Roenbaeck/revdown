# Releasing Revdown

Publishing a GitHub release triggers `.github/workflows/release.yml`. It runs
the quality checks, builds a universal macOS DMG and a Windows x64 NSIS
installer, and attaches both to that release.

The workflow works before paid signing credentials are configured:

- macOS artifacts receive an ad-hoc signature. This satisfies Apple Silicon's
  local signature requirement but does not establish developer identity or
  avoid Gatekeeper approval.
- Windows artifacts remain unsigned and may show a SmartScreen warning.

For identified macOS signing and notarization, add these repository secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `KEYCHAIN_PASSWORD`: an arbitrary strong password for the temporary CI
  keychain
- `APPLE_ID`: Apple Developer account email
- `APPLE_PASSWORD`: app-specific Apple ID password
- `APPLE_TEAM_ID`: Apple Developer team ID

The first three enable Developer ID signing. All six enable notarization and
stapling.

For Windows Authenticode signing, add:

- `WINDOWS_CERTIFICATE`: base64-encoded code-signing `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD`: `.pfx` password

The workflow imports the certificate only into the ephemeral runner user's
certificate store, injects the detected thumbprint through a temporary Tauri
configuration, uses SHA-256 and DigiCert's timestamp service, and never writes
certificate material into the repository.

Before publishing, make the version in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` agree with the intended
release tag. Run the complete local validation map in `DEVELOPMENT.md`, then
create and publish the GitHub release.
