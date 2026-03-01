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

## Acknowledgements and inspirations

This plugin family in the development vault took inspiration from existing Obsidian ecosystem work, especially:

- `super-duper-audio-recorder` by Thiago MadPin (`madpin`) for audio-recorder UX direction.
- Obsidian core `audio-recorder` workflows for baseline recording behavior.
- `aloud-tts` by Adrian Lyjak and `transcription-audio` by cha-yh for end-to-end audio workflows.
- `ai-providers` / `local-gpt` by Pavel Frankov for multi-provider configuration patterns used across companion plugins.

Credit where due:

- Matthias defined product direction, selected workflows, and performed iterative testing/QA.
- Codex produced most implementation code and release-automation scaffolding under Matthias's guidance.

## Build

```bash
npm ci
npm run build
```

## Release

- GitHub Actions release workflow: `.github/workflows/release.yml`
- Required release assets: `main.js`, `manifest.json`, and `styles.css`
- Git tag must match `manifest.json.version` exactly (no `v` prefix)
