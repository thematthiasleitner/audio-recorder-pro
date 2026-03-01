# Audio Recorder Pro

Mobile-friendly Obsidian plugin for fast local audio capture.

## Features

- Real-time recording timer with clear state indicators.
- Pause / continue / stop controls.
- Lightweight format preference with automatic fallback when unsupported on the current device.
- Optional automatic embed insertion into the active note after save.
- Enhanced embedded audio player controls in preview output (play/pause, seek, skip, speed).

## Commands

- `Open recorder`
- `Quick start recording`

## Settings

- Save folder
- File name prefix
- Preferred lightweight audio type
- Insert audio embed after save

## Policy disclosures

- This plugin works locally and does not send audio to external services.
- No account or API key is required.
- No telemetry, ads, or self-update mechanism is included.

## Build

```bash
npm ci
npm run build
```

## Release

- GitHub Actions release workflow: `.github/workflows/release.yml`
- Required release assets: `main.js`, `manifest.json`, and `styles.css`
- Git tag must match `manifest.json.version` exactly (no `v` prefix)
