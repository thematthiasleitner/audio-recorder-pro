import {
  App,
  KeymapEventHandler,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
} from "obsidian";

type AudioFormatId = "auto" | "webm-opus" | "webm" | "ogg-opus" | "mp4-aac";
type SpecificAudioFormatId = Exclude<AudioFormatId, "auto">;
type RecorderSessionState = "idle" | "requesting" | "recording" | "paused" | "stopping";
type StopMode = "save" | "discard";

interface AudioRecorderProSettings {
  saveFolder: string;
  fileNamePrefix: string;
  preferredFormat: AudioFormatId;
  insertEmbedAfterSave: boolean;
}

interface AudioFormatDefinition {
  id: SpecificAudioFormatId;
  label: string;
  description: string;
  extension: string;
  mimeCandidates: string[];
}

interface ResolvedRecorderFormat {
  requested: AudioFormatId;
  selectedId: SpecificAudioFormatId | "browser-default";
  label: string;
  extension: string;
  mimeType?: string;
  fallbackNote?: string;
}

interface SaveRecordingResult {
  path: string;
  insertedEmbed: boolean;
}

const AUDIO_FORMAT_DEFINITIONS: AudioFormatDefinition[] = [
  {
    id: "webm-opus",
    label: "WebM (Opus, small)",
    description: "Usually the smallest option on desktop and Android.",
    extension: "webm",
    mimeCandidates: ["audio/webm;codecs=opus", "audio/webm"],
  },
  {
    id: "mp4-aac",
    label: "M4A/MP4 (AAC, small)",
    description: "Good compatibility on Apple devices when supported.",
    extension: "m4a",
    mimeCandidates: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
  },
  {
    id: "ogg-opus",
    label: "Ogg (Opus, small)",
    description: "Compact format, but not supported on all mobile devices.",
    extension: "ogg",
    mimeCandidates: ["audio/ogg;codecs=opus", "audio/ogg"],
  },
  {
    id: "webm",
    label: "WebM (browser default WebM)",
    description: "Fallback WebM preference when Opus label support is unclear.",
    extension: "webm",
    mimeCandidates: ["audio/webm"],
  },
];

const AUDIO_FORMAT_BY_ID: Record<SpecificAudioFormatId, AudioFormatDefinition> = {
  "webm-opus": AUDIO_FORMAT_DEFINITIONS[0],
  "mp4-aac": AUDIO_FORMAT_DEFINITIONS[1],
  "ogg-opus": AUDIO_FORMAT_DEFINITIONS[2],
  webm: AUDIO_FORMAT_DEFINITIONS[3],
};

const AUTO_FORMAT_PRIORITY: SpecificAudioFormatId[] = [
  "webm-opus",
  "mp4-aac",
  "ogg-opus",
  "webm",
];

const DEFAULT_SETTINGS: AudioRecorderProSettings = {
  saveFolder: "Attachments/Recordings",
  fileNamePrefix: "recording",
  preferredFormat: "auto",
  insertEmbedAfterSave: true,
};

const EMBEDDED_AUDIO_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const EMBEDDED_AUDIO_SKIP_SECONDS = 15;

export default class AudioRecorderProPlugin extends Plugin {
  settings: AudioRecorderProSettings = { ...DEFAULT_SETTINGS };
  private recorderModal: AudioRecorderModal | null = null;
  private embeddedAudioPlaybackRate = 1;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("mic", "Open recorder", () => {
      this.openRecorderModal(false);
    });

    this.addCommand({
      id: "open",
      name: "Open recorder",
      callback: () => this.openRecorderModal(false),
    });

    this.addCommand({
      id: "quick-start-audio-recording",
      name: "Quick start recording",
      callback: () => this.openRecorderModal(true),
    });

    this.registerMarkdownPostProcessor((el) => {
      this.enhanceEmbeddedAudioPlayers(el);
    });

    this.addSettingTab(new AudioRecorderProSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.recorderModal) {
      this.recorderModal.close();
      this.recorderModal = null;
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<AudioRecorderProSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
    };

    if (!isAudioFormatId(this.settings.preferredFormat)) {
      this.settings.preferredFormat = DEFAULT_SETTINGS.preferredFormat;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  openRecorderModal(startImmediately: boolean): void {
    if (this.recorderModal) {
      new Notice("The recorder is already open.");
      return;
    }

    const modal = new AudioRecorderModal(this.app, this, startImmediately);
    this.recorderModal = modal;
    modal.open();
  }

  handleRecorderModalClosed(modal: AudioRecorderModal): void {
    if (this.recorderModal === modal) {
      this.recorderModal = null;
    }
  }

  getPreferredRecorderFormat(): ResolvedRecorderFormat {
    return resolveRecorderFormat(this.settings.preferredFormat);
  }

  private enhanceEmbeddedAudioPlayers(rootEl: HTMLElement): void {
    const audioEls = rootEl.querySelectorAll<HTMLAudioElement>("audio");
    for (const audioEl of audioEls) {
      this.attachCustomAudioPlayer(audioEl);
    }
  }

  private attachCustomAudioPlayer(audioEl: HTMLAudioElement): void {
    if (audioEl.dataset.arpCustomPlayerEnhanced === "true") {
      return;
    }

    const parent = audioEl.parentElement;
    if (!parent) {
      return;
    }

    const player = document.createElement("div");
    player.className = "arp-embedded-player";
    player.setAttribute("role", "group");
    player.setAttribute("aria-label", "Audio playback controls");
    player.dataset.arpPlaying = "false";

    const transportRow = document.createElement("div");
    transportRow.className = "arp-embedded-transport";

    const playPauseButton = document.createElement("button");
    playPauseButton.type = "button";
    playPauseButton.className = "arp-embedded-btn arp-embedded-btn-primary";
    playPauseButton.textContent = "Play";
    playPauseButton.setAttribute("aria-label", "Play audio");

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "arp-embedded-btn";
    backButton.textContent = "-15s";
    backButton.setAttribute("aria-label", "Jump back 15 seconds");

    const forwardButton = document.createElement("button");
    forwardButton.type = "button";
    forwardButton.className = "arp-embedded-btn";
    forwardButton.textContent = "+15s";
    forwardButton.setAttribute("aria-label", "Jump forward 15 seconds");

    const timeEl = document.createElement("div");
    timeEl.className = "arp-embedded-time";
    timeEl.textContent = "--:-- / --:--";

    transportRow.appendChild(playPauseButton);
    transportRow.appendChild(backButton);
    transportRow.appendChild(forwardButton);
    transportRow.appendChild(timeEl);

    const progressRow = document.createElement("div");
    progressRow.className = "arp-embedded-progress-row";

    const currentTimeEl = document.createElement("span");
    currentTimeEl.className = "arp-embedded-time-mini";
    currentTimeEl.textContent = "0:00";

    const seekInput = document.createElement("input");
    seekInput.className = "arp-embedded-seek";
    seekInput.type = "range";
    seekInput.min = "0";
    seekInput.max = "1000";
    seekInput.step = "1";
    seekInput.value = "0";
    seekInput.disabled = true;
    seekInput.setAttribute("aria-label", "Seek audio position");

    const durationEl = document.createElement("span");
    durationEl.className = "arp-embedded-time-mini";
    durationEl.textContent = "--:--";

    progressRow.appendChild(currentTimeEl);
    progressRow.appendChild(seekInput);
    progressRow.appendChild(durationEl);

    const speedRow = document.createElement("div");
    speedRow.className = "arp-embedded-speed-row";

    const speedLabel = document.createElement("span");
    speedLabel.className = "arp-embedded-speed-label";
    speedLabel.textContent = "Speed";
    speedRow.appendChild(speedLabel);

    const speedButtonsWrap = document.createElement("div");
    speedButtonsWrap.className = "arp-embedded-speed-buttons";
    speedRow.appendChild(speedButtonsWrap);

    const speedButtons = new Map<number, HTMLButtonElement>();
    for (const speed of EMBEDDED_AUDIO_SPEED_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "arp-embedded-speed-btn";
      button.textContent = `${formatSpeed(speed)}x`;
      button.setAttribute("aria-label", `Set playback speed to ${formatSpeed(speed)}x`);
      button.addEventListener("click", () => {
        applyRate(speed);
      });
      speedButtons.set(speed, button);
      speedButtonsWrap.appendChild(button);
    }

    player.appendChild(transportRow);
    player.appendChild(progressRow);
    player.appendChild(speedRow);

    let isScrubbing = false;

    const getDuration = (): number | null =>
      Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : null;

    const clampTime = (time: number): number => {
      const duration = getDuration();
      if (duration === null) {
        return Math.max(0, time);
      }
      return Math.min(Math.max(0, time), duration);
    };

    const updateTimeDisplay = (): void => {
      const duration = getDuration();
      const currentTime = clampTime(audioEl.currentTime || 0);
      currentTimeEl.textContent = formatPlaybackTime(currentTime);
      durationEl.textContent = duration === null ? "--:--" : formatPlaybackTime(duration);
      timeEl.textContent = `${formatPlaybackTime(currentTime)} / ${
        duration === null ? "--:--" : formatPlaybackTime(duration)
      }`;
    };

    const updateSeekDisplay = (): void => {
      const duration = getDuration();
      if (!duration) {
        seekInput.value = "0";
        seekInput.disabled = true;
        return;
      }

      seekInput.disabled = false;
      if (isScrubbing) {
        return;
      }

      const ratio = duration > 0 ? clampTime(audioEl.currentTime || 0) / duration : 0;
      seekInput.value = String(Math.round(ratio * 1000));
    };

    const updatePlayState = (): void => {
      const isPlaying = !audioEl.paused && !audioEl.ended;
      playPauseButton.textContent = isPlaying ? "Pause" : "Play";
      playPauseButton.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");
      playPauseButton.setAttribute("aria-pressed", String(isPlaying));
      player.dataset.arpPlaying = isPlaying ? "true" : "false";
    };

    const updateSpeedButtons = (): void => {
      const currentRate = audioEl.playbackRate || 1;
      for (const [rate, button] of speedButtons) {
        const isActive = Math.abs(currentRate - rate) < 0.001;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      }
    };

    const applyRate = (rate: number): void => {
      if (!Number.isFinite(rate) || rate <= 0) {
        return;
      }
      audioEl.playbackRate = rate;
      this.embeddedAudioPlaybackRate = rate;
      updateSpeedButtons();
    };

    const jumpBy = (deltaSeconds: number): void => {
      audioEl.currentTime = clampTime((audioEl.currentTime || 0) + deltaSeconds);
      updateTimeDisplay();
      updateSeekDisplay();
    };

    playPauseButton.addEventListener("click", () => {
      if (audioEl.paused) {
        void audioEl.play().catch(() => {
          // Playback can fail if the element is not yet ready.
        });
        return;
      }
      audioEl.pause();
    });

    backButton.addEventListener("click", () => {
      jumpBy(-EMBEDDED_AUDIO_SKIP_SECONDS);
    });

    forwardButton.addEventListener("click", () => {
      jumpBy(EMBEDDED_AUDIO_SKIP_SECONDS);
    });

    const seekFromSlider = (): void => {
      const duration = getDuration();
      if (!duration) {
        return;
      }
      const ratio = Math.min(1, Math.max(0, Number(seekInput.value) / 1000));
      audioEl.currentTime = duration * ratio;
      updateTimeDisplay();
    };

    seekInput.addEventListener("input", () => {
      isScrubbing = true;
      seekFromSlider();
    });

    seekInput.addEventListener("change", () => {
      seekFromSlider();
      isScrubbing = false;
      updateSeekDisplay();
    });

    seekInput.addEventListener("pointerup", () => {
      isScrubbing = false;
      updateSeekDisplay();
    });

    seekInput.addEventListener("touchend", () => {
      isScrubbing = false;
      updateSeekDisplay();
    });

    audioEl.addEventListener("loadedmetadata", () => {
      updateTimeDisplay();
      updateSeekDisplay();
    });
    audioEl.addEventListener("durationchange", () => {
      updateTimeDisplay();
      updateSeekDisplay();
    });
    audioEl.addEventListener("timeupdate", () => {
      updateTimeDisplay();
      updateSeekDisplay();
    });
    audioEl.addEventListener("play", updatePlayState);
    audioEl.addEventListener("pause", updatePlayState);
    audioEl.addEventListener("ended", () => {
      updatePlayState();
      updateTimeDisplay();
      updateSeekDisplay();
    });
    audioEl.addEventListener("ratechange", () => {
      const rate = audioEl.playbackRate;
      if (EMBEDDED_AUDIO_SPEED_OPTIONS.includes(rate as (typeof EMBEDDED_AUDIO_SPEED_OPTIONS)[number])) {
        this.embeddedAudioPlaybackRate = rate;
      }
      updateSpeedButtons();
    });

    audioEl.preload = audioEl.preload || "metadata";
    audioEl.controls = false;
    audioEl.removeAttribute("controls");
    audioEl.classList.add("arp-embedded-audio-source");
    audioEl.setAttribute("playsinline", "true");

    audioEl.insertAdjacentElement("afterend", player);
    audioEl.dataset.arpCustomPlayerEnhanced = "true";

    applyRate(this.embeddedAudioPlaybackRate);
    updatePlayState();
    updateTimeDisplay();
    updateSeekDisplay();
  }

  async saveRecordingBlob(
    blob: Blob,
    suggestedExtension: string,
    recorderMimeType?: string,
  ): Promise<SaveRecordingResult> {
    const folderPath = normalizeFolderPath(this.settings.saveFolder);
    if (folderPath) {
      await this.ensureFolderExists(folderPath);
    }

    const extension =
      extensionFromMimeType(recorderMimeType) ??
      extensionFromMimeType(blob.type) ??
      sanitizeExtension(suggestedExtension) ??
      "webm";

    const baseName = `${sanitizeFileNamePart(this.settings.fileNamePrefix)}-${formatTimestamp(
      new Date(),
    )}`;
    const targetPath = this.buildUniquePath(folderPath, baseName, extension);
    const buffer = await blob.arrayBuffer();

    await this.app.vault.createBinary(targetPath, buffer);

    const insertedEmbed = this.settings.insertEmbedAfterSave
      ? this.insertAudioEmbedIntoActiveNote(targetPath)
      : false;

    return { path: targetPath, insertedEmbed };
  }

  private buildUniquePath(folderPath: string, baseName: string, extension: string): string {
    const prefix = folderPath ? `${folderPath}/` : "";
    let index = 0;

    while (true) {
      const suffix = index === 0 ? "" : `-${index}`;
      const candidate = `${prefix}${baseName}${suffix}.${extension}`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      index += 1;
    }
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) {
      return;
    }

    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private insertAudioEmbedIntoActiveNote(path: string): boolean {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      return false;
    }

    const editor = markdownView.editor;
    const cursor = editor.getCursor();
    const prefix = cursor.ch > 0 ? "\n" : "";
    editor.replaceSelection(`${prefix}![[${path}]]\n`);
    return true;
  }
}

class AudioRecorderModal extends Modal {
  private readonly plugin: AudioRecorderProPlugin;
  private readonly startImmediately: boolean;

  private state: RecorderSessionState = "idle";
  private pendingStopMode: StopMode = "save";
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private timerHandle: number | null = null;
  private baseElapsedMs = 0;
  private activeRunStartedAtMs: number | null = null;
  private currentFormat: ResolvedRecorderFormat | null = null;
  private isClosing = false;

  private rootEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private formatEl!: HTMLElement;
  private saveTargetEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private startButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private resumeButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private escapeHandler: KeymapEventHandler | null = null;

  private readonly blockOutsideDismiss = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (this.modalEl.contains(target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if ("stopImmediatePropagation" in event && typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };

  constructor(app: App, plugin: AudioRecorderProPlugin, startImmediately: boolean) {
    super(app);
    this.plugin = plugin;
    this.startImmediately = startImmediately;
  }

  onOpen(): void {
    this.buildUi();
    this.containerEl.addEventListener("pointerdown", this.blockOutsideDismiss, true);
    this.containerEl.addEventListener("touchstart", this.blockOutsideDismiss, true);
    this.containerEl.addEventListener("click", this.blockOutsideDismiss, true);
    this.escapeHandler = this.scope.register([], "Escape", (event) => {
      event.preventDefault();
      return false;
    });
    this.updateTimerDisplay();
    this.updateFormatDisplay();
    this.setInfo("Tap Start to record.");
    this.updateUi();

    if (this.startImmediately) {
      window.setTimeout(() => {
        if (!this.isClosing && this.state === "idle") {
          void this.startRecording();
        }
      }, 0);
    }
  }

  onClose(): void {
    this.isClosing = true;
    this.containerEl.removeEventListener("pointerdown", this.blockOutsideDismiss, true);
    this.containerEl.removeEventListener("touchstart", this.blockOutsideDismiss, true);
    this.containerEl.removeEventListener("click", this.blockOutsideDismiss, true);
    if (this.escapeHandler) {
      this.scope.unregister(this.escapeHandler);
      this.escapeHandler = null;
    }
    this.stopTimer();
    this.pendingStopMode = "discard";

    const activeRecorder = this.mediaRecorder;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      try {
        activeRecorder.stop();
      } catch {
        // Ignore recorder shutdown errors during modal close.
      }
    }

    this.detachRecorderHandlers();
    this.stopStreamTracks();
    this.contentEl.empty();
    this.plugin.handleRecorderModalClosed(this);
  }

  private buildUi(): void {
    this.contentEl.empty();
    this.modalEl.classList.add("arp-modal");

    const root = this.contentEl.createDiv({ cls: "arp-root" });
    this.rootEl = root;

    const header = root.createDiv({ cls: "arp-header" });
    header.createDiv({ cls: "arp-title", text: "Audio Recorder Pro" });

    const stage = root.createDiv({ cls: "arp-stage" });
    const statusRow = stage.createDiv({ cls: "arp-status-row" });
    this.statusEl = statusRow.createDiv({
      cls: "arp-status-pill",
      attr: { "aria-live": "polite" },
      text: "Ready",
    });
    this.timerEl = statusRow.createDiv({
      cls: "arp-timer",
      attr: { "aria-live": "off" },
      text: "00:00.00",
    });

    const controlsPanel = root.createDiv({ cls: "arp-panel arp-controls-panel" });
    controlsPanel.createDiv({ cls: "arp-panel-label", text: "Controls" });
    const controls = controlsPanel.createDiv({ cls: "arp-controls" });
    this.startButton = this.createButton(controls, "Start", () => {
      void this.startRecording();
    });
    this.startButton.classList.add("mod-cta", "arp-button-start");

    this.pauseButton = this.createButton(controls, "Pause", () => {
      this.pauseRecording();
    });
    this.pauseButton.classList.add("arp-button-secondary");

    this.resumeButton = this.createButton(controls, "Continue", () => {
      this.resumeRecording();
    });
    this.resumeButton.classList.add("arp-button-secondary");

    this.stopButton = this.createButton(controls, "Stop", () => {
      void this.requestStop("save");
    });
    this.stopButton.classList.add("arp-button-stop");
  }

  private createButton(
    container: HTMLElement,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = container.createEl("button", { text: label, type: "button" });
    button.addEventListener("click", onClick);
    return button;
  }

  private async startRecording(): Promise<void> {
    if (this.state !== "idle") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Microphone recording is not supported on this device.";
      this.setInfo(message);
      new Notice(message);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      const message = "This device does not support MediaRecorder for audio capture.";
      this.setInfo(message);
      new Notice(message);
      return;
    }

    this.state = "requesting";
    this.updateUi();
    this.setInfo("Requesting microphone permission...");

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.isClosing) {
        stopTracks(stream);
        return;
      }

      let resolvedFormat = this.plugin.getPreferredRecorderFormat();
      let recorder = this.createRecorder(stream, resolvedFormat);

      if (!recorder && resolvedFormat.mimeType) {
        const originalLabel = resolvedFormat.label;
        resolvedFormat = {
          ...resolvedFormat,
          selectedId: "browser-default",
          label: "Browser default",
          mimeType: undefined,
          fallbackNote: `Preferred format (${originalLabel}) could not start on this device. Using browser default format instead.`,
        };
        recorder = this.createRecorder(stream, resolvedFormat);
      }

      if (!recorder) {
        throw new Error("Unable to create a microphone recorder on this device.");
      }

      this.mediaStream = stream;
      this.mediaRecorder = recorder;
      this.chunks = [];
      this.pendingStopMode = "save";
      this.baseElapsedMs = 0;
      this.activeRunStartedAtMs = null;

      const actualMimeType = recorder.mimeType || resolvedFormat.mimeType;
      this.currentFormat = {
        ...resolvedFormat,
        mimeType: actualMimeType || undefined,
        extension: extensionFromMimeType(actualMimeType) ?? resolvedFormat.extension,
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        const recorderError = (event as Event & { error?: DOMException }).error;
        const message = recorderError?.message || "Audio recorder error.";
        this.setInfo(message);
        new Notice(message);
      };

      recorder.onstop = () => {
        void this.handleRecorderStopped();
      };

      recorder.start(250);
      this.state = "recording";
      this.startTimer();
      this.updateTimerDisplay();
      this.updateFormatDisplay();
      this.updateUi();

      const formatMessage = this.currentFormat.fallbackNote
        ? `Recording started. ${this.currentFormat.fallbackNote}`
        : "Recording started.";
      this.setInfo(formatMessage);
    } catch (error) {
      if (stream) {
        stopTracks(stream);
      }
      this.mediaStream = null;
      this.mediaRecorder = null;
      this.chunks = [];
      this.currentFormat = null;
      this.state = "idle";
      this.stopTimer();
      this.updateTimerDisplay();
      this.updateFormatDisplay();
      this.updateUi();

      const message = `Could not start recording: ${errorMessage(error)}`;
      this.setInfo(message);
      new Notice(message);
    }
  }

  private createRecorder(
    stream: MediaStream,
    format: ResolvedRecorderFormat,
  ): MediaRecorder | null {
    try {
      if (format.mimeType) {
        return new MediaRecorder(stream, { mimeType: format.mimeType });
      }
      return new MediaRecorder(stream);
    } catch {
      return null;
    }
  }

  private pauseRecording(): void {
    if (this.state !== "recording" || !this.mediaRecorder) {
      return;
    }

    try {
      this.mediaRecorder.pause();
      this.captureElapsed();
      this.stopTimer();
      this.state = "paused";
      this.updateUi();
      this.updateTimerDisplay();
      this.setInfo("Recording paused.");
    } catch (error) {
      const message = `Could not pause recording: ${errorMessage(error)}`;
      this.setInfo(message);
      new Notice(message);
    }
  }

  private resumeRecording(): void {
    if (this.state !== "paused" || !this.mediaRecorder) {
      return;
    }

    try {
      this.mediaRecorder.resume();
      this.state = "recording";
      this.startTimer();
      this.updateUi();
      this.setInfo("Recording continued.");
    } catch (error) {
      const message = `Could not continue recording: ${errorMessage(error)}`;
      this.setInfo(message);
      new Notice(message);
    }
  }

  private requestStop(mode: StopMode): void {
    if (!this.mediaRecorder || (this.state !== "recording" && this.state !== "paused")) {
      return;
    }

    this.pendingStopMode = mode;
    this.captureElapsed();
    this.stopTimer();
    this.state = "stopping";
    this.updateUi();
    this.updateTimerDisplay();
    this.setInfo(mode === "discard" ? "Discarding recording..." : "Finalizing recording...");

    try {
      this.mediaRecorder.stop();
    } catch (error) {
      const message = `Could not stop recording: ${errorMessage(error)}`;
      this.setInfo(message);
      this.state = this.mediaRecorder.state === "paused" ? "paused" : "recording";
      if (this.state === "recording") {
        this.startTimer();
      }
      this.updateUi();
      new Notice(message);
    }
  }

  private async handleRecorderStopped(): Promise<void> {
    const shouldDiscard = this.pendingStopMode === "discard" || this.isClosing;
    const recorderMimeType = this.mediaRecorder?.mimeType || this.currentFormat?.mimeType;

    const blob = new Blob(this.chunks, recorderMimeType ? { type: recorderMimeType } : {});

    this.detachRecorderHandlers();
    this.stopStreamTracks();

    if (shouldDiscard) {
      this.resetSessionUi("Recording discarded.");
      return;
    }

    if (blob.size === 0) {
      this.resetSessionUi("No audio was captured. Try again.");
      new Notice("No audio was captured.");
      return;
    }

    const extension = this.currentFormat?.extension ?? extensionFromMimeType(recorderMimeType) ?? "webm";

    try {
      const result = await this.plugin.saveRecordingBlob(blob, extension, recorderMimeType);
      const insertedText = result.insertedEmbed ? " (embed inserted)" : "";
      const message = `Saved recording to ${result.path}${insertedText}`;
      this.resetSessionUi(message);
      new Notice(message, 5000);
    } catch (error) {
      const message = `Could not save recording: ${errorMessage(error)}`;
      this.resetSessionUi(message);
      new Notice(message);
    }
  }

  private resetSessionUi(infoMessage: string): void {
    this.stopTimer();
    this.baseElapsedMs = 0;
    this.activeRunStartedAtMs = null;
    this.state = "idle";
    this.pendingStopMode = "save";
    this.chunks = [];
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.currentFormat = null;
    this.updateTimerDisplay();
    this.updateFormatDisplay();
    this.setInfo(infoMessage);
    this.updateUi();
  }

  private detachRecorderHandlers(): void {
    if (!this.mediaRecorder) {
      return;
    }

    this.mediaRecorder.ondataavailable = null;
    this.mediaRecorder.onerror = null;
    this.mediaRecorder.onstop = null;
  }

  private stopStreamTracks(): void {
    if (!this.mediaStream) {
      return;
    }

    stopTracks(this.mediaStream);
    this.mediaStream = null;
  }

  private startTimer(): void {
    this.stopTimer();
    this.activeRunStartedAtMs = Date.now();
    this.timerHandle = window.setInterval(() => {
      this.updateTimerDisplay();
    }, 100);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private captureElapsed(): void {
    if (this.activeRunStartedAtMs !== null) {
      this.baseElapsedMs += Math.max(0, Date.now() - this.activeRunStartedAtMs);
      this.activeRunStartedAtMs = null;
    }
  }

  private getElapsedMs(): number {
    if (this.activeRunStartedAtMs === null) {
      return this.baseElapsedMs;
    }

    return this.baseElapsedMs + Math.max(0, Date.now() - this.activeRunStartedAtMs);
  }

  private updateTimerDisplay(): void {
    if (!this.timerEl) {
      return;
    }
    this.timerEl.textContent = formatElapsed(this.getElapsedMs());
  }

  private updateFormatDisplay(): void {
    if (!this.formatEl) {
      return;
    }

    if (this.currentFormat) {
      const mimeText = this.currentFormat.mimeType ? ` (${this.currentFormat.mimeType})` : "";
      this.formatEl.textContent = `Current format: ${this.currentFormat.label}${mimeText}`;
      return;
    }

    if (this.plugin.settings.preferredFormat === "auto") {
      this.formatEl.textContent = "Preferred format: auto";
      return;
    }

    const preferred = AUDIO_FORMAT_BY_ID[this.plugin.settings.preferredFormat];
    this.formatEl.textContent = `Preferred format: ${preferred.label}`;
  }

  private updateSaveTargetDisplay(): void {
    if (!this.saveTargetEl) {
      return;
    }

    const folder = normalizeFolderPath(this.plugin.settings.saveFolder);
    const embedState = this.plugin.settings.insertEmbedAfterSave ? "Embed on save: on" : "Embed on save: off";
    this.saveTargetEl.textContent = `${folder} • ${embedState}`;
  }

  private setInfo(message: string): void {
    if (!this.infoEl) {
      return;
    }
    this.infoEl.textContent = message;
  }

  private updateUi(): void {
    if (!this.startButton) {
      return;
    }

    const canStart = this.state === "idle";
    const canPause = this.state === "recording";
    const canResume = this.state === "paused";
    const canStop = this.state === "recording" || this.state === "paused";

    this.startButton.disabled = !canStart;
    this.pauseButton.disabled = !canPause;
    this.resumeButton.disabled = !canResume;
    this.stopButton.disabled = !canStop;

    this.startButton.textContent = this.state === "idle" ? "Start" : "Start";
    this.updateSaveTargetDisplay();

    const statusLabel =
      this.state === "recording"
        ? "Recording"
        : this.state === "paused"
          ? "Paused"
          : this.state === "stopping"
            ? "Finalizing"
            : this.state === "requesting"
              ? "Waiting for mic"
              : "Ready";

    this.statusEl.textContent = statusLabel;
    this.statusEl.className = "arp-status-pill";
    this.rootEl.setAttribute("data-arp-state", this.state);

    if (this.state === "recording") {
      this.statusEl.classList.add("arp-status-recording");
    } else if (this.state === "paused") {
      this.statusEl.classList.add("arp-status-paused");
    } else if (this.state === "stopping") {
      this.statusEl.classList.add("arp-status-stopping");
    } else if (this.state === "requesting") {
      this.statusEl.classList.add("arp-status-requesting");
    }
  }
}

class AudioRecorderProSettingTab extends PluginSettingTab {
  private readonly plugin: AudioRecorderProPlugin;

  constructor(app: App, plugin: AudioRecorderProPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Audio Recorder Pro").setHeading();

    new Setting(containerEl)
      .setName("Save folder")
      .setDesc("Vault folder for recorded audio files. Nested folders are created automatically.")
      .addText((text) => {
        text.setPlaceholder("Attachments/recordings");
        text.setValue(this.plugin.settings.saveFolder);
        text.onChange(async (value) => {
          this.plugin.settings.saveFolder = normalizeFolderPath(value || DEFAULT_SETTINGS.saveFolder);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("File name prefix")
      .setDesc("Prefix used before the timestamp in each recording file name.")
      .addText((text) => {
        text.setPlaceholder("Recording");
        text.setValue(this.plugin.settings.fileNamePrefix);
        text.onChange(async (value) => {
          this.plugin.settings.fileNamePrefix = sanitizeFileNamePart(value);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Preferred lightweight audio type")
      .setDesc(
        "Choose a lightweight format. If the device does not support it, the plugin falls back automatically.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", "Auto (recommended)");
        for (const format of AUDIO_FORMAT_DEFINITIONS) {
          dropdown.addOption(format.id, format.label);
        }
        dropdown.setValue(this.plugin.settings.preferredFormat);
        dropdown.onChange(async (value) => {
          this.plugin.settings.preferredFormat = isAudioFormatId(value)
            ? value
            : DEFAULT_SETTINGS.preferredFormat;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Insert audio embed after save")
      .setDesc("When enabled, the plugin inserts `![[recording-file]]` into the active Markdown note.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.insertEmbedAfterSave);
        toggle.onChange(async (value) => {
          this.plugin.settings.insertEmbedAfterSave = value;
          await this.plugin.saveSettings();
        });
      });

    const formatInfo = containerEl.createDiv({ cls: "setting-item-description" });
    formatInfo.createEl("p", {
      text: "Format notes:",
    });
    const list = formatInfo.createEl("ul");
    for (const format of AUDIO_FORMAT_DEFINITIONS) {
      list.createEl("li", {
        text: `${format.label}: ${format.description}`,
      });
    }
  }
}

function isAudioFormatId(value: unknown): value is AudioFormatId {
  return (
    value === "auto" ||
    value === "webm-opus" ||
    value === "webm" ||
    value === "ogg-opus" ||
    value === "mp4-aac"
  );
}

function resolveRecorderFormat(preferred: AudioFormatId): ResolvedRecorderFormat {
  const attempts: AudioFormatDefinition[] =
    preferred === "auto"
      ? AUTO_FORMAT_PRIORITY.map((id) => AUDIO_FORMAT_BY_ID[id])
      : [
          AUDIO_FORMAT_BY_ID[preferred],
          ...AUTO_FORMAT_PRIORITY.filter((id) => id !== preferred).map((id) => AUDIO_FORMAT_BY_ID[id]),
        ];

  for (const format of attempts) {
    const supportedMime = format.mimeCandidates.find((mime) => isMimeTypeSupported(mime));
    if (supportedMime) {
      const explicitFallback =
        preferred !== "auto" && format.id !== preferred
          ? `Preferred format (${AUDIO_FORMAT_BY_ID[preferred].label}) is not supported on this device. Using ${format.label} instead.`
          : undefined;

      return {
        requested: preferred,
        selectedId: format.id,
        label: format.label,
        extension: format.extension,
        mimeType: supportedMime,
        fallbackNote: explicitFallback,
      };
    }
  }

  const defaultFallbackNote =
    preferred === "auto"
      ? "No preferred MIME type reported as supported, so browser default format will be used."
      : `Preferred format (${AUDIO_FORMAT_BY_ID[preferred].label}) is not supported on this device. Using browser default format instead.`;

  return {
    requested: preferred,
    selectedId: "browser-default",
    label: "Browser default",
    extension: "webm",
    fallbackNote: defaultFallbackNote,
  };
}

function isMimeTypeSupported(mimeType: string): boolean {
  if (typeof MediaRecorder === "undefined") {
    return false;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return true;
  }

  try {
    return MediaRecorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

function extensionFromMimeType(mimeType: string | undefined | null): string | null {
  if (!mimeType) {
    return null;
  }

  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) {
    return "webm";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("mp4")) {
    return "m4a";
  }
  if (normalized.includes("aac")) {
    return "aac";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }
  return null;
}

function normalizeFolderPath(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) {
    return normalizePath(DEFAULT_SETTINGS.saveFolder);
  }
  return normalizePath(trimmed);
}

function sanitizeFileNamePart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "recording";
}

function sanitizeExtension(value: string): string | null {
  const cleaned = value.trim().replace(/^\.+/, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleaned || null;
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatElapsed(ms: number): string {
  const safeMs = Math.max(0, ms);
  const centiseconds = Math.floor((safeMs % 1000) / 10);
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`;
  }

  return `${minutes}:${pad(secs)}`;
}

function formatSpeed(speed: number): string {
  const rounded = Number(speed.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore track shutdown errors.
    }
  }
}
