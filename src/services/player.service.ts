import { spawn, execSync, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { log } from "../utils/logger.ts";
import { getMpvYtdlRawOptions } from "../utils/ytdlp.ts";
import { getMpvExecutable } from "../utils/runtime-dependencies.ts";

export type PlayerEventCallback = (event: {
  timePos?: number;
  duration?: number;
  paused?: boolean;
  eof?: boolean; // end of file (播放結束)
}) => void;

type SessionPurpose = "active" | "standby" | "retiring";
type SessionConfirmMode = "playback" | "preload";
type SessionSource =
  | { type: "youtube"; value: string }
  | { type: "stream"; value: string };

type SessionConfirmation = {
  mode: SessionConfirmMode;
  timer: ReturnType<typeof setTimeout>;
  settle: (ready: boolean) => void;
  reject: (error: Error) => void;
};

type PlayerSession = {
  id: number;
  purpose: SessionPurpose;
  source: SessionSource;
  volumeMultiplier: number;
  targetVolume: number;
  duration: number | null;
  process: ChildProcess;
  ipcSocket: Socket | null;
  ipcPath: string;
  ipcConnectRetries: number;
  eofHandled: boolean;
  ready: boolean;
  trackId: string | null;
  confirmation: SessionConfirmation | null;
};

const CROSSFADE_TICK_MS = 100;
const RETIRING_STOP_GRACE_MS = 180;
const SESSION_VOLUME_RETRY_DELAY_MS = 120;
const MAX_USER_VOLUME = 100;
const MAX_SESSION_VOLUME = 200;
const MAX_TRACK_VOLUME_MULTIPLIER = 1;
// dynaudnorm:RMS 模式把感知響度拉向一致,3 秒級高斯平滑避免增益抽動(pumping),
// m=5 限制最大增益避免把安靜前奏放大成噪音。
const VOLUME_NORMALIZATION_FILTER = "dynaudnorm=f=400:g=15:m=5:r=0.8:p=0.9";

class PlayerService {
  private static instance: PlayerService;
  private readonly playbackConfirmationTimeoutMs = 2500;
  private readonly preloadConfirmationTimeoutMs = 12000;
  private readonly maxIpcRetries = 60;
  private activeSession: PlayerSession | null = null;
  private standbySession: PlayerSession | null = null;
  private retiringSessions = new Set<PlayerSession>();
  private intentionallyStoppedProcesses = new WeakSet<ChildProcess>();
  private currentVolume = 70;
  private isPlaying = false;
  private eventCallback: PlayerEventCallback | null = null;
  private playSessionId = 0;
  private crossfadeTimer: ReturnType<typeof setInterval> | null = null;
  private crossfadeFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private retiringStopTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  private volumeNormalizationEnabled = true;

  private constructor() {
    this.cleanupOrphanedMpvProcesses();
    this.setupExitHandlers();
  }

  private cleanupOrphanedMpvProcesses(): void {
    try {
      if (process.platform === "win32") {
        log.debug("Skipping orphaned mpv cleanup on Windows");
      } else {
        const result = execSync(
          `pgrep -f "input-ipc-server=/tmp/mpvsocket-" 2>/dev/null || true`,
          { encoding: "utf-8" },
        );
        const pids = result.trim().split("\n").filter(Boolean);

        if (pids.length > 0) {
          log.info("Found orphaned mpv processes, cleaning up", { pids });
          for (const pid of pids) {
            try {
              process.kill(parseInt(pid, 10), "SIGTERM");
            } catch {
              // 進程可能已結束
            }
          }
        }
      }
    } catch (error) {
      log.debug("Orphaned mpv cleanup skipped", { error });
    }
  }

  private setupExitHandlers(): void {
    const cleanup = () => {
      log.info("Server shutting down, cleaning up mpv processes");
      this.stop();
    };

    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    process.once("exit", cleanup);
  }

  static getInstance(): PlayerService {
    if (!PlayerService.instance) {
      PlayerService.instance = new PlayerService();
    }
    return PlayerService.instance;
  }

  onEvent(callback: PlayerEventCallback): void {
    this.eventCallback = callback;
  }

  private getIpcPath(sessionId: number): string {
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\mpvsocket-${process.pid}-${sessionId}`;
    }

    return `/tmp/mpvsocket-${process.pid}-${sessionId}`;
  }

  private getAudioArgs(): string[] {
    if (process.platform === "darwin") {
      log.debug("Using CoreAudio for macOS");
      return ["--ao=coreaudio"];
    }

    if (process.platform === "win32") {
      log.debug("Using WASAPI for Windows");
      return ["--ao=wasapi"];
    }

    log.debug("Using PulseAudio/ALSA for Linux");
    return ["--ao=pulse,alsa"];
  }

  private clampUserVolume(volume: number): number {
    return Math.max(0, Math.min(MAX_USER_VOLUME, volume));
  }

  private clampSessionVolume(volume: number): number {
    return Math.max(0, Math.min(MAX_SESSION_VOLUME, volume));
  }

  private normalizeVolumeMultiplier(multiplier: number | undefined): number {
    if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
      return 1;
    }

    return Math.max(0.1, Math.min(MAX_TRACK_VOLUME_MULTIPLIER, multiplier));
  }

  private computeTargetVolume(
    userVolume: number,
    volumeMultiplier: number,
  ): number {
    return this.clampSessionVolume(
      userVolume * this.normalizeVolumeMultiplier(volumeMultiplier),
    );
  }

  private refreshSessionTargetVolume(
    session: PlayerSession,
    userVolume: number = this.currentVolume,
  ): number {
    session.volumeMultiplier = this.normalizeVolumeMultiplier(
      session.volumeMultiplier,
    );
    session.targetVolume = this.computeTargetVolume(
      userVolume,
      session.volumeMultiplier,
    );
    return session.targetVolume;
  }

  private buildMpvArgs(
    session: PlayerSession,
    options: { volume: number; startPaused: boolean },
  ): string[] {
    const mpvArgs = [
      "--no-video",
      `--volume=${options.volume}`,
      `--volume-max=${MAX_SESSION_VOLUME}`,
      "--no-audio-display",
      "--msg-level=all=info",
      `--input-ipc-server=${session.ipcPath}`,
      "--cache=yes",
      "--cache-secs=30",
      "--network-timeout=60",
      "--gapless-audio=yes",
      ...(options.startPaused ? ["--pause=yes"] : []),
      ...(this.volumeNormalizationEnabled
        ? [`--af=lavfi=[${VOLUME_NORMALIZATION_FILTER}]`]
        : []),
      ...this.getAudioArgs(),
    ];

    if (session.source.type === "youtube") {
      const ytdlRawOptions = getMpvYtdlRawOptions();
      if (ytdlRawOptions.length > 0) {
        mpvArgs.push(`--ytdl-raw-options=${ytdlRawOptions.join(",")}`);
      }

      mpvArgs.push(`https://www.youtube.com/watch?v=${session.source.value}`);
      return mpvArgs;
    }

    mpvArgs.push(session.source.value);
    return mpvArgs;
  }

  private isTrackedSession(session: PlayerSession): boolean {
    return (
      this.activeSession === session ||
      this.standbySession === session ||
      this.retiringSessions.has(session)
    );
  }

  private clearCrossfadeTimer(): void {
    if (this.crossfadeTimer) {
      clearInterval(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
  }

  private clearCrossfadeFinalizeTimeout(): void {
    if (this.crossfadeFinalizeTimeout) {
      clearTimeout(this.crossfadeFinalizeTimeout);
      this.crossfadeFinalizeTimeout = null;
    }
  }

  private clearRetiringStopTimeout(sessionId: number): void {
    const timeout = this.retiringStopTimeouts.get(sessionId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.retiringStopTimeouts.delete(sessionId);
  }

  private clearAllRetiringStopTimeouts(): void {
    for (const timeout of this.retiringStopTimeouts.values()) {
      clearTimeout(timeout);
    }

    this.retiringStopTimeouts.clear();
  }

  private beginSessionConfirmation(
    session: PlayerSession,
    mode: SessionConfirmMode,
    settle: (ready: boolean) => void,
    reject: (error: Error) => void,
  ): void {
    this.clearSessionConfirmation(session);

    const timer = setTimeout(() => {
      if (mode === "playback") {
        log.info("Playback confirmation timeout elapsed; treating playback as started", {
          timeoutMs: this.playbackConfirmationTimeoutMs,
          sessionId: session.id,
        });
        this.resolveSessionConfirmation(session, true);
        return;
      }

      this.rejectSessionConfirmation(
        session,
        new Error(`Timed out while preloading track for session ${session.id}`),
      );
    }, mode === "playback" ? this.playbackConfirmationTimeoutMs : this.preloadConfirmationTimeoutMs);

    session.confirmation = {
      mode,
      timer,
      settle,
      reject,
    };
  }

  private clearSessionConfirmation(session: PlayerSession): void {
    if (!session.confirmation) {
      return;
    }

    clearTimeout(session.confirmation.timer);
    session.confirmation = null;
  }

  private resolveSessionConfirmation(
    session: PlayerSession,
    ready: boolean,
  ): boolean {
    if (!session.confirmation) {
      return false;
    }

    clearTimeout(session.confirmation.timer);
    const { settle } = session.confirmation;
    session.confirmation = null;
    session.ready = ready;
    settle(ready);
    return true;
  }

  private rejectSessionConfirmation(
    session: PlayerSession,
    error: Error,
  ): boolean {
    if (!session.confirmation) {
      return false;
    }

    clearTimeout(session.confirmation.timer);
    const { reject } = session.confirmation;
    session.confirmation = null;
    reject(error);
    return true;
  }

  private sendIpcCommand(session: PlayerSession, command: unknown[]): boolean {
    if (!session.ipcSocket || session.ipcSocket.destroyed) {
      log.debug("Cannot send IPC command: socket not connected", {
        sessionId: session.id,
        purpose: session.purpose,
      });
      return false;
    }

    session.ipcSocket.write(`${JSON.stringify({ command })}\n`);
    return true;
  }

  private setSessionPaused(session: PlayerSession, paused: boolean): boolean {
    return this.sendIpcCommand(session, ["set_property", "pause", paused]);
  }

  private setSessionVolume(session: PlayerSession, volume: number): boolean {
    const nextVolume = this.clampSessionVolume(volume);
    log.debug("Applying session volume", {
      sessionId: session.id,
      purpose: session.purpose,
      trackId: session.trackId,
      volumeMultiplier: session.volumeMultiplier,
      targetVolume: session.targetVolume,
      requestedVolume: volume,
      appliedVolume: nextVolume,
    });
    return this.sendIpcCommand(session, ["set_property", "volume", nextVolume]);
  }

  private ensureSessionTargetVolume(
    session: PlayerSession,
    options: {
      onlyWhenActive?: boolean;
      onlyWhenNoCrossfade?: boolean;
      retryDelayMs?: number;
    } = {},
  ): void {
    const applyTargetVolume = () => {
      if (!this.isTrackedSession(session)) {
        return;
      }

      if (options.onlyWhenActive && this.activeSession !== session) {
        return;
      }

      if (options.onlyWhenNoCrossfade && this.crossfadeTimer) {
        return;
      }

      this.setSessionVolume(session, session.targetVolume);
    };

    applyTargetVolume();
    setTimeout(
      applyTargetVolume,
      options.retryDelayMs ?? SESSION_VOLUME_RETRY_DELAY_MS,
    );
  }

  private promoteStandbyToActive(
    trackId: string,
  ): { incoming: PlayerSession; outgoing: PlayerSession | null } | null {
    const standby = this.standbySession;
    if (!standby || !standby.ready || standby.trackId !== trackId) {
      return null;
    }

    const outgoing = this.activeSession;
    this.clearCrossfadeTimer();
    this.clearCrossfadeFinalizeTimeout();
    this.refreshSessionTargetVolume(standby);
    this.standbySession = null;
    this.activeSession = standby;
    standby.purpose = "active";

    return {
      incoming: standby,
      outgoing,
    };
  }

  private finalizeCrossfadeVolumes(
    outgoing: PlayerSession,
    incoming: PlayerSession,
  ): void {
    if (this.activeSession !== incoming) {
      return;
    }

    this.clearCrossfadeTimer();
    this.clearCrossfadeFinalizeTimeout();
    this.setSessionVolume(outgoing, 0);
    this.ensureSessionTargetVolume(incoming, {
      onlyWhenActive: true,
      onlyWhenNoCrossfade: true,
    });
  }

  private connectSessionIpc(session: PlayerSession): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attemptConnect = () => {
        if (!this.isTrackedSession(session)) {
          reject(new Error(`Session ${session.id} is no longer tracked`));
          return;
        }

        log.debug("Attempting IPC connection", {
          path: session.ipcPath,
          sessionId: session.id,
          purpose: session.purpose,
        });

        const socket = connect(session.ipcPath);
        session.ipcSocket = socket;

        socket.on("connect", () => {
          if (session.ipcSocket !== socket) {
            log.debug("Ignoring stale IPC socket connection", {
              sessionId: session.id,
            });
            socket.destroy();
            return;
          }

          log.info("IPC socket connected", {
            sessionId: session.id,
            purpose: session.purpose,
          });
          session.ipcConnectRetries = 0;
          this.sendIpcCommand(session, ["observe_property", 1, "time-pos"]);
          this.sendIpcCommand(session, ["observe_property", 2, "duration"]);
          this.sendIpcCommand(session, ["observe_property", 3, "pause"]);
          this.sendIpcCommand(session, ["observe_property", 4, "eof-reached"]);
          this.sendIpcCommand(session, ["observe_property", 5, "idle-active"]);

          resolve();
        });

        socket.on("data", (data: Buffer) => {
          if (session.ipcSocket !== socket) {
            log.debug("Ignoring stale IPC socket payload", {
              sessionId: session.id,
            });
            return;
          }

          this.handleIpcMessage(session, data.toString());
        });

        socket.on("error", (err: Error) => {
          if (session.ipcSocket !== socket) {
            log.debug("Ignoring stale IPC socket error", {
              error: err.message,
              sessionId: session.id,
            });
            return;
          }

          log.debug("IPC socket error", {
            error: err.message,
            sessionId: session.id,
            purpose: session.purpose,
          });

          const maxRetries =
            process.platform === "win32"
              ? this.maxIpcRetries * 2
              : this.maxIpcRetries;

          if (
            session.ipcConnectRetries < maxRetries &&
            this.isTrackedSession(session)
          ) {
            session.ipcConnectRetries += 1;
            setTimeout(
              attemptConnect,
              process.platform === "win32" ? 500 : 500,
            );
          } else {
            reject(
              new Error(
                `Failed to connect to IPC socket after ${maxRetries} attempts`,
              ),
            );
          }
        });

        socket.on("close", () => {
          if (session.ipcSocket !== socket) {
            return;
          }

          log.debug("IPC socket closed", {
            sessionId: session.id,
            purpose: session.purpose,
          });
          session.ipcSocket = null;
        });
      };

      attemptConnect();
    });
  }

  private handleIpcMessage(session: PlayerSession, data: string): void {
    const lines = data.trim().split("\n");

    log.debug("IPC message received", {
      rawData: data.substring(0, 200),
      lineCount: lines.length,
      sessionId: session.id,
      purpose: session.purpose,
    });

    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        log.debug("IPC parsed", {
          event: message.event,
          name: message.name,
          data: message.data,
          sessionId: session.id,
          purpose: session.purpose,
        });

        if (message.event === "file-loaded") {
          this.resolveSessionConfirmation(session, true);
          continue;
        }

        if (message.event === "property-change") {
          this.handlePropertyChange(session, message);
        }
      } catch {
        // 忽略無法解析的訊息
      }
    }
  }

  private handlePropertyChange(
    session: PlayerSession,
    message: { name: string; data: number | boolean },
  ): void {
    if (
      message.name === "duration" &&
      typeof message.data === "number" &&
      Number.isFinite(message.data) &&
      message.data >= 0
    ) {
      session.duration = message.data;
    }

    if (message.name === "time-pos") {
      if (
        session.confirmation?.mode === "playback" &&
        typeof message.data === "number" &&
        message.data > 0
      ) {
        this.resolveSessionConfirmation(session, true);
      }
    } else if (
      message.name === "duration" &&
      session.confirmation?.mode === "preload" &&
      typeof message.data === "number" &&
      message.data > 0
    ) {
      this.resolveSessionConfirmation(session, true);
    } else {
      log.info("Property change", {
        name: message.name,
        data: message.data,
        sessionId: session.id,
        purpose: session.purpose,
      });
    }

    if (session !== this.activeSession || !this.eventCallback) {
      return;
    }

    const event: {
      timePos?: number;
      duration?: number;
      paused?: boolean;
      eof?: boolean;
    } = {};

    switch (message.name) {
      case "time-pos":
        event.timePos = message.data as number;
        break;

      case "duration":
        event.duration = message.data as number;
        break;

      case "pause":
        event.paused = message.data as boolean;
        this.isPlaying = !event.paused;
        break;

      case "eof-reached":
        event.eof = message.data as boolean;
        if (event.eof) {
          this.isPlaying = false;
          session.eofHandled = true;
          log.info("End of file reached", { sessionId: session.id });
        }
        break;

      case "idle-active":
        if (message.data === true && !session.eofHandled) {
          log.info("mpv entered idle mode, triggering EOF fallback", {
            sessionId: session.id,
          });
          this.isPlaying = false;
          session.eofHandled = true;
          event.eof = true;
        } else if (message.data === true) {
          log.debug("mpv idle mode already handled via eof-reached", {
            sessionId: session.id,
          });
        }
        break;
    }

    this.eventCallback(event);
  }

  private markProcessAsIntentionallyStopped(
    process: ChildProcess | null,
  ): void {
    if (process) {
      this.intentionallyStoppedProcesses.add(process);
    }
  }

  private consumeIntentionallyStoppedProcess(process: ChildProcess): boolean {
    if (!this.intentionallyStoppedProcesses.has(process)) {
      return false;
    }

    this.intentionallyStoppedProcesses.delete(process);
    return true;
  }

  private spawnSession(options: {
    source: SessionSource;
    purpose: SessionPurpose;
    trackId?: string | null;
    startPaused?: boolean;
    volume?: number;
    volumeMultiplier?: number;
    confirmMode: SessionConfirmMode;
  }): { session: PlayerSession; ready: Promise<boolean> } {
    const sessionId = ++this.playSessionId;
    const session: PlayerSession = {
      id: sessionId,
      purpose: options.purpose,
      source: options.source,
      volumeMultiplier: this.normalizeVolumeMultiplier(options.volumeMultiplier),
      targetVolume: 0,
      duration: null,
      process: null as unknown as ChildProcess,
      ipcSocket: null,
      ipcPath: this.getIpcPath(sessionId),
      ipcConnectRetries: 0,
      eofHandled: false,
      ready: false,
      trackId: options.trackId ?? null,
      confirmation: null,
    };

    const startPaused = options.startPaused ?? false;
    const userVolume =
      options.volume !== undefined
        ? this.clampUserVolume(options.volume)
        : this.currentVolume;
    session.targetVolume = this.computeTargetVolume(
      userVolume,
      session.volumeMultiplier,
    );
    const mpvArgs = this.buildMpvArgs(session, {
      volume: session.targetVolume,
      startPaused,
    });
    const mpvCommand = getMpvExecutable();

    log.info("Spawning mpv process", {
      command: mpvCommand,
      argsCount: mpvArgs.length,
      sessionId: session.id,
      purpose: session.purpose,
      trackId: session.trackId,
      ipcPath: session.ipcPath,
      platform: process.platform,
      startPaused,
    });

    const spawnedProcess = spawn(mpvCommand, mpvArgs, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    session.process = spawnedProcess;

    const ready = new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settleReady = (value: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };
      const rejectReady = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      const ipcDelay = process.platform === "win32" ? 500 : 200;
      setTimeout(() => {
        this.connectSessionIpc(session)
          .then(() => {
            this.beginSessionConfirmation(
              session,
              options.confirmMode,
              settleReady,
              rejectReady,
            );
          })
          .catch((error) => {
            if (!this.isTrackedSession(session)) {
              log.debug("Skipping IPC connection failure for untracked session", {
                error: error.message,
                sessionId: session.id,
                purpose: session.purpose,
                ipcPath: session.ipcPath,
              });
              return;
            }

            log.error(
              "Failed to connect IPC - playback will continue without state sync",
              {
                error: error.message,
                sessionId: session.id,
                purpose: session.purpose,
                ipcPath: session.ipcPath,
              },
            );

            if (options.confirmMode === "playback") {
              settleReady(true);
              return;
            }

            this.stopSpecificSession(session);
            rejectReady(error);
          });
      }, ipcDelay);

      spawnedProcess.stderr?.on("data", (data: Buffer) => {
        const error = data.toString().trim();
        if (error) {
          log.warn("mpv stderr", {
            output: error,
            sessionId: session.id,
            purpose: session.purpose,
          });
        }
      });

      spawnedProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString().trim();
        if (output) {
          log.debug("mpv stdout", {
            output: output.substring(0, 200),
            sessionId: session.id,
            purpose: session.purpose,
          });
        }
      });

      spawnedProcess.on("exit", (code, signal) => {
        this.handleSessionExit(session, code, signal, settleReady, rejectReady);
      });

      spawnedProcess.on("error", (error: Error) => {
        log.error("mpv process error", {
          error: error.message,
          sessionId: session.id,
          purpose: session.purpose,
        });

        if ("code" in error && error.code === "ENOENT") {
          rejectReady(
            new Error(
              "mpv executable not found. Install mpv and ensure it's in PATH.",
            ),
          );
          return;
        }

        rejectReady(error);
      });
    });

    return {
      session,
      ready,
    };
  }

  private handleSessionExit(
    session: PlayerSession,
    code: number | null,
    signal: NodeJS.Signals | null,
    settleReady: (ready: boolean) => void,
    rejectReady: (error: Error) => void,
  ): void {
    const intentionallyStopped = this.consumeIntentionallyStoppedProcess(
      session.process,
    );
    const wasActive = this.activeSession === session;
    const wasStandby = this.standbySession === session;

    log.info("mpv process exited", {
      code,
      signal,
      sessionId: session.id,
      purpose: session.purpose,
      eofHandled: session.eofHandled,
      isPlaying: this.isPlaying,
      intentionallyStopped,
    });

    if (wasActive) {
      this.isPlaying = false;
      this.activeSession = null;
    }

    if (wasStandby) {
      this.standbySession = null;
    }

    if (this.retiringSessions.has(session)) {
      this.retiringSessions.delete(session);
      this.clearRetiringStopTimeout(session.id);
    }

    if (session.ipcSocket && !session.ipcSocket.destroyed) {
      session.ipcSocket.destroy();
    }

    if (intentionallyStopped) {
      if (!this.resolveSessionConfirmation(session, false)) {
        settleReady(false);
      }
      return;
    }

    if (code === 0) {
      if (!this.resolveSessionConfirmation(session, true)) {
        settleReady(true);
      }

      if (wasActive && !session.eofHandled && this.eventCallback) {
        this.eventCallback({ eof: true });
      }
      return;
    }

    if (code !== null && code > 0) {
      const error = new Error(`mpv exited with code ${code}`);
      if (!this.rejectSessionConfirmation(session, error)) {
        rejectReady(error);
      }
    }
  }

  private stopSpecificSession(session: PlayerSession | null): void {
    if (!session) {
      return;
    }

    this.clearSessionConfirmation(session);
    this.clearRetiringStopTimeout(session.id);

    if (this.activeSession === session) {
      this.activeSession = null;
    }

    if (this.standbySession === session) {
      this.standbySession = null;
    }

    if (this.retiringSessions.has(session)) {
      this.retiringSessions.delete(session);
    }

    if (session.ipcSocket && !session.ipcSocket.destroyed) {
      session.ipcSocket.destroy();
      session.ipcSocket = null;
    }

    try {
      this.markProcessAsIntentionallyStopped(session.process);
      session.process.kill("SIGTERM");
      log.debug("mpv process killed", {
        sessionId: session.id,
        purpose: session.purpose,
      });
    } catch (error) {
      log.error("Error killing mpv process", {
        error,
        sessionId: session.id,
        purpose: session.purpose,
      });
    }
  }

  private stopAllSessions(): void {
    this.clearCrossfadeTimer();
    this.clearCrossfadeFinalizeTimeout();
    this.clearAllRetiringStopTimeouts();
    this.stopSpecificSession(this.activeSession);
    this.stopSpecificSession(this.standbySession);

    for (const session of [...this.retiringSessions]) {
      this.stopSpecificSession(session);
    }

    this.retiringSessions.clear();
    this.isPlaying = false;
  }

  private scheduleRetiringStop(session: PlayerSession, durationMs: number): void {
    this.clearRetiringStopTimeout(session.id);
    this.retiringStopTimeouts.set(
      session.id,
      setTimeout(() => {
        this.stopSpecificSession(session);
      }, durationMs + RETIRING_STOP_GRACE_MS),
    );
  }

  private finalizeCrossfadeInterruption(): void {
    if (this.retiringSessions.size === 0) {
      return;
    }

    this.clearCrossfadeTimer();
    this.clearCrossfadeFinalizeTimeout();
    for (const session of [...this.retiringSessions]) {
      this.stopSpecificSession(session);
    }

    if (this.activeSession) {
      this.ensureSessionTargetVolume(this.activeSession, {
        onlyWhenActive: true,
        onlyWhenNoCrossfade: true,
      });
    }
  }

  private async playSource(
    source: SessionSource,
    options: {
      trackId?: string | null;
      volume?: number;
      volumeMultiplier?: number;
    } = {},
  ): Promise<void> {
    this.stopAllSessions();

    if (options.volume !== undefined) {
      this.currentVolume = this.clampUserVolume(options.volume);
    }

    const { session, ready } = this.spawnSession({
      source,
      purpose: "active",
      confirmMode: "playback",
      startPaused: false,
      volume: this.currentVolume,
      volumeMultiplier: options.volumeMultiplier,
      trackId:
        options.trackId ??
        (source.type === "youtube" ? source.value : null),
    });

    this.activeSession = session;
    this.isPlaying = true;

    try {
      const didStart = await ready;
      if (!didStart) {
        if (this.activeSession === session) {
          this.stopSpecificSession(session);
        }
        this.isPlaying = false;
        throw new Error("Playback session was cancelled before start");
      }

      if (this.activeSession === session) {
        this.ensureSessionTargetVolume(session, {
          onlyWhenActive: true,
          onlyWhenNoCrossfade: true,
        });
      }
    } catch (error) {
      if (this.activeSession === session) {
        this.stopSpecificSession(session);
      }
      this.isPlaying = false;
      throw error;
    }
  }

  async play(
    videoId: string,
    options: { volume?: number; volumeMultiplier?: number } = {},
  ): Promise<void> {
    log.info("Playing video", {
      videoId,
      volume: options.volume ?? this.currentVolume,
      volumeMultiplier: options.volumeMultiplier ?? 1,
    });

    await this.playSource(
      { type: "youtube", value: videoId },
      {
        trackId: videoId,
        volume: options.volume,
        volumeMultiplier: options.volumeMultiplier,
      },
    );
  }

  async playUrl(
    streamUrl: string,
    options: {
      trackId?: string | null;
      volume?: number;
      volumeMultiplier?: number;
    } = {},
  ): Promise<void> {
    log.info("Playing stream URL", {
      volume: options.volume ?? this.currentVolume,
      volumeMultiplier: options.volumeMultiplier ?? 1,
      trackId: options.trackId ?? null,
    });

    await this.playSource(
      { type: "stream", value: streamUrl },
      options,
    );
  }

  async preloadUrl(
    trackId: string,
    streamUrl: string,
    options: { volumeMultiplier?: number } = {},
  ): Promise<boolean> {
    if (
      this.standbySession?.trackId === trackId &&
      this.standbySession.ready
    ) {
      this.standbySession.volumeMultiplier = this.normalizeVolumeMultiplier(
        options.volumeMultiplier,
      );
      this.refreshSessionTargetVolume(this.standbySession);
      this.ensureSessionTargetVolume(this.standbySession);
      return true;
    }

    if (this.standbySession) {
      this.stopSpecificSession(this.standbySession);
    }

    const { session, ready } = this.spawnSession({
      source: { type: "stream", value: streamUrl },
      purpose: "standby",
      confirmMode: "preload",
      startPaused: true,
      volumeMultiplier: options.volumeMultiplier,
      trackId,
    });

    this.standbySession = session;

    try {
      const isReady = await ready;
      if (
        isReady &&
        this.standbySession === session &&
        session.ready &&
        session.trackId === trackId
      ) {
        this.ensureSessionTargetVolume(session);
      }
      return Boolean(
        isReady &&
          this.standbySession === session &&
          session.ready &&
          session.trackId === trackId,
      );
    } catch (error) {
      if (this.standbySession === session) {
        this.stopSpecificSession(session);
      }
      throw error;
    }
  }

  cancelPreload(trackId?: string): void {
    if (!this.standbySession) {
      return;
    }

    if (trackId && this.standbySession.trackId !== trackId) {
      return;
    }

    this.stopSpecificSession(this.standbySession);
  }

  getPreloadedTrackId(): string | null {
    if (!this.standbySession?.ready) {
      return null;
    }

    return this.standbySession.trackId;
  }

  isTrackPreloaded(trackId: string): boolean {
    return this.getPreloadedTrackId() === trackId;
  }

  async playPreloaded(trackId: string): Promise<boolean> {
    const promoted = this.promoteStandbyToActive(trackId);
    if (!promoted) {
      return false;
    }

    const { incoming, outgoing } = promoted;
    this.setSessionPaused(incoming, false);
    this.ensureSessionTargetVolume(incoming, {
      onlyWhenActive: true,
      onlyWhenNoCrossfade: true,
    });

    if (outgoing) {
      this.stopSpecificSession(outgoing);
    }

    this.isPlaying = true;
    return true;
  }

  async crossfadeToPreloaded(
    trackId: string,
    durationMs: number,
  ): Promise<boolean> {
    if (!this.activeSession) {
      return false;
    }

    const promoted = this.promoteStandbyToActive(trackId);
    if (!promoted?.outgoing) {
      return false;
    }

    const { incoming, outgoing } = promoted;
    outgoing.purpose = "retiring";
    this.retiringSessions.add(outgoing);

    this.setSessionVolume(incoming, 0);
    this.setSessionPaused(incoming, false);

    const totalDuration = Math.max(CROSSFADE_TICK_MS, durationMs);
    const startedAt = Date.now();

    const applyVolumes = () => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / totalDuration));
      const fadeOutFactor = Math.cos((progress * Math.PI) / 2);
      const fadeInFactor = Math.sin((progress * Math.PI) / 2);

      this.setSessionVolume(outgoing, outgoing.targetVolume * fadeOutFactor);
      this.setSessionVolume(incoming, incoming.targetVolume * fadeInFactor);

      if (progress >= 1) {
        this.finalizeCrossfadeVolumes(outgoing, incoming);
      }
    };

    applyVolumes();
    this.crossfadeTimer = setInterval(applyVolumes, CROSSFADE_TICK_MS);
    this.clearCrossfadeFinalizeTimeout();
    this.crossfadeFinalizeTimeout = setTimeout(() => {
      this.finalizeCrossfadeVolumes(outgoing, incoming);
    }, totalDuration + CROSSFADE_TICK_MS);
    this.scheduleRetiringStop(outgoing, totalDuration);
    this.isPlaying = true;

    log.info("Crossfade started", {
      outgoingSessionId: outgoing.id,
      incomingSessionId: incoming.id,
      durationMs: totalDuration,
      trackId,
    });

    return true;
  }

  pause(): void {
    if (!this.activeSession) {
      return;
    }

    this.finalizeCrossfadeInterruption();
    log.debug("Pausing playback", {
      sessionId: this.activeSession.id,
    });
    this.isPlaying = false;
    this.setSessionPaused(this.activeSession, true);
  }

  resume(): void {
    if (!this.activeSession) {
      return;
    }

    log.debug("Resuming playback", {
      sessionId: this.activeSession.id,
    });
    this.isPlaying = true;
    this.setSessionPaused(this.activeSession, false);
  }

  stop(): void {
    log.debug("Stopping playback");
    this.stopAllSessions();
  }

  setVolume(volume: number): void {
    this.currentVolume = this.clampUserVolume(volume);
    log.debug("Setting volume", { volume: this.currentVolume });

    if (this.activeSession) {
      this.refreshSessionTargetVolume(this.activeSession);
    }

    if (this.standbySession) {
      this.refreshSessionTargetVolume(this.standbySession);
    }

    for (const session of this.retiringSessions) {
      this.refreshSessionTargetVolume(session);
    }

    if (this.activeSession && !this.crossfadeTimer) {
      this.ensureSessionTargetVolume(this.activeSession, {
        onlyWhenActive: true,
        onlyWhenNoCrossfade: true,
      });
    }

    if (this.standbySession) {
      this.ensureSessionTargetVolume(this.standbySession);
    }
  }

  setTrackVolumeMultiplier(trackId: string, volumeMultiplier: number): void {
    const normalizedTrackId = trackId.trim();
    if (!normalizedTrackId) {
      return;
    }

    const nextMultiplier = this.normalizeVolumeMultiplier(volumeMultiplier);
    log.debug("Updating track volume multiplier", {
      trackId: normalizedTrackId,
      requestedMultiplier: volumeMultiplier,
      volumeMultiplier: nextMultiplier,
      userVolume: this.currentVolume,
    });
    let updatedActive = false;
    let updatedStandby = false;

    const updateSession = (session: PlayerSession | null): boolean => {
      if (!session || session.trackId !== normalizedTrackId) {
        return false;
      }

      session.volumeMultiplier = nextMultiplier;
      this.refreshSessionTargetVolume(session);
      return true;
    };

    updatedActive = updateSession(this.activeSession);
    updatedStandby = updateSession(this.standbySession);

    for (const session of this.retiringSessions) {
      updateSession(session);
    }

    if (updatedActive && this.activeSession && !this.crossfadeTimer) {
      this.ensureSessionTargetVolume(this.activeSession, {
        onlyWhenActive: true,
        onlyWhenNoCrossfade: true,
      });
    }

    if (updatedStandby && this.standbySession) {
      this.ensureSessionTargetVolume(this.standbySession);
    }
  }

  setVolumeNormalizationEnabled(enabled: boolean): void {
    if (this.volumeNormalizationEnabled === enabled) {
      return;
    }

    this.volumeNormalizationEnabled = enabled;
    log.info("Volume normalization filter toggled", { enabled });

    const command = enabled
      ? ["af", "set", `lavfi=[${VOLUME_NORMALIZATION_FILTER}]`]
      : ["af", "clr", ""];

    const applyToSession = (session: PlayerSession | null): void => {
      if (!session) {
        return;
      }
      this.sendIpcCommand(session, command);
    };

    applyToSession(this.activeSession);
    applyToSession(this.standbySession);
    for (const session of this.retiringSessions) {
      applyToSession(session);
    }
  }

  isVolumeNormalizationEnabled(): boolean {
    return this.volumeNormalizationEnabled;
  }

  seek(position: number): void {
    if (!this.isPlaying || !this.activeSession) {
      log.warn("Cannot seek: no active playback");
      return;
    }

    if (!Number.isFinite(position) || position < 0) {
      log.warn("Invalid seek position", { position });
      return;
    }

    log.debug("Seeking to position", { position });
    this.finalizeCrossfadeInterruption();
    this.sendIpcCommand(this.activeSession, ["seek", position, "absolute"]);
  }

  getVolume(): number {
    return this.currentVolume;
  }

  getActiveDuration(): number | null {
    return this.activeSession?.duration ?? null;
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  resetForTests(): void {
    this.stop();
    this.eventCallback = null;
    this.currentVolume = 70;
    this.isPlaying = false;
    this.intentionallyStoppedProcesses = new WeakSet<ChildProcess>();
    this.playSessionId = 0;
    this.activeSession = null;
    this.standbySession = null;
    this.retiringSessions.clear();
    this.clearCrossfadeTimer();
    this.clearCrossfadeFinalizeTimeout();
    this.clearAllRetiringStopTimeouts();
    this.volumeNormalizationEnabled = true;
  }
}

export function getPlayerService(): PlayerService {
  return PlayerService.getInstance();
}

export function __resetPlayerServiceForTests(): void {
  PlayerService.getInstance().resetForTests();
}
