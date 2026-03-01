# Obsidian Plugin Spec

## 1. Problem and target user

- Problem statement: Obsidian's built-in/typical audio capture flows are inconsistent across desktop and mobile and often lack a clear in-progress timer with pause/resume.
- Primary user: Obsidian users capturing voice notes, meeting notes, and quick ideas on desktop and mobile.
- Why existing Obsidian workflows are insufficient: Recording UX varies by platform/plugin, and lightweight format control is often unclear or not configurable.

## 2. Outcome and success criteria

- Desired outcome: A single modal recorder workflow that works on both desktop and mobile with visible elapsed time and pause/continue/stop controls.
- Quantifiable success metric: User can produce a saved audio file in under 3 taps/clicks after opening the recorder.
- Non-functional expectations (speed, reliability, UX quality): Fast modal open, clear status messaging, safe cleanup on modal close/unload, graceful fallback when formats are unsupported.

## 3. Scope split

- MVP: Open recorder modal, request microphone permission, show real-time timer, pause/resume, stop/save to vault, settings for save folder/file prefix/preferred lightweight audio type, runtime fallback to supported format, optional embed insertion.
- vNext: Input device selection (desktop), bitrate controls, waveform meter, recording preview/playback before save.
- Out of scope: Transcription, trimming/editing, cloud upload, background recording service.

## 4. Functional slices

- Command surface: Command palette command to open recorder and quick-start recording; ribbon icon to open recorder.
- Settings surface: Save folder, file name prefix, preferred audio format, insert embed after save toggle.
- View/modal/ribbon surface: Mobile-friendly modal with large timer and controls; ribbon mic button.
- Vault/file operations: Create nested folders if missing, save binary audio file with unique timestamped filename, optionally insert embed into active note.
- Background/event behavior: Timer interval updates while recording; cleanup timers/stream tracks/recorder handlers on stop, close, and unload.

## 5. Data model

- Settings schema: `{ saveFolder, fileNamePrefix, preferredFormat, insertEmbedAfterSave }`.
- Defaults: `Attachments/Recordings`, `recording`, `auto`, `true`.
- Migration strategy: Shallow merge with defaults and validate `preferredFormat`; fallback to `auto` for unknown values.

## 6. Platform assumptions

- Desktop support: Yes (Web/Electron microphone APIs via `getUserMedia` + `MediaRecorder`).
- Mobile support: Yes, with runtime MIME fallback depending on WebView support.
- `isDesktopOnly` value: `false`.

## 7. Acceptance checks

- [x] Check 1 (observable behavior): Running `Audio Recorder Pro: Open recorder` opens a modal with a visible timer and Start/Pause/Continue/Stop controls.
- [x] Check 2 (observable behavior): While recording, the timer updates in real time and freezes during pause, then continues after resume.
- [x] Check 3 (observable behavior): Stopping a recording saves an audio file into the configured vault folder with a unique timestamped filename and optional embed insertion.
- [x] Failure-mode check: If the preferred format is unsupported or microphone permission fails, the user gets a clear notice/message and the recorder does not crash.

## 8. Risk register

- Risk: MIME support varies widely across desktop/mobile WebViews.
- Impact: User-selected format may be unavailable on some devices.
- Mitigation: Runtime format detection and fallback to another lightweight format or browser default, with a visible message.
