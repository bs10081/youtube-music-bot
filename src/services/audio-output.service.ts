import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AudioOutputMode,
  AudioOutputStatus,
  AudioSinkInfo,
} from "../types/index.ts";
import { log } from "../utils/logger.ts";

const execFileAsync = promisify(execFile);

// 排除虛擬麥克風 sink(如 "Steam Streaming Microphone"、"Jump Desktop Microphone");
// 其餘(含 monitor 音訊、串流喇叭)全部列出,由使用者自行判斷
const EXCLUDED_SINK_PATTERN = /(microphone|\bmic\b)/i;

// sink 狀態快取時間:watcher 每 2 秒輪詢 GET /api/audio/output,
// 快取略短於輪詢間隔,讓每輪都拿得到新狀態又不會重複打 pactl
const SINK_CACHE_TTL_MS = 1500;

const PACTL_TIMEOUT_MS = 5000;

interface PactlSink {
  index: number;
  name: string;
  description: string;
  state: string;
}

interface PactlSinkInput {
  index: number;
  sink: number;
  properties?: Record<string, string>;
}

export class AudioOutputError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_SUPPORTED" | "SINK_NOT_FOUND" | "PACTL_FAILED",
  ) {
    super(message);
    this.name = "AudioOutputError";
  }
}

function resolveInitialMode(): AudioOutputMode {
  const raw = process.env.AUDIO_OUTPUT_MODE?.trim().toLowerCase();
  return raw === "manual" ? "manual" : "system";
}

export class AudioOutputService {
  // PulseAudio 切換僅在容器(Linux)部署有意義;原生 macOS 的 coreaudio 本來就跟隨系統
  private readonly supported = process.platform === "linux";
  private mode: AudioOutputMode = resolveInitialMode();
  private changeListeners: Array<(status: AudioOutputStatus) => void> = [];

  private cachedSinks: AudioSinkInfo[] = [];
  private cachedDefaultSink: string | null = null;
  private cacheTimestamp = 0;

  onChange(listener: (status: AudioOutputStatus) => void): void {
    this.changeListeners.push(listener);
  }

  private emitChange(status: AudioOutputStatus): void {
    for (const listener of this.changeListeners) {
      try {
        listener(status);
      } catch (error) {
        log.error("Audio output change listener failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async pactl(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("pactl", args, {
        timeout: PACTL_TIMEOUT_MS,
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("pactl command failed", { args, error: message });
      throw new AudioOutputError(`pactl ${args[0]} failed: ${message}`, "PACTL_FAILED");
    }
  }

  private async fetchSinks(): Promise<{
    sinks: AudioSinkInfo[];
    defaultSink: string | null;
  }> {
    const [sinksJson, defaultSinkRaw] = await Promise.all([
      this.pactl(["--format=json", "list", "sinks"]),
      this.pactl(["get-default-sink"]),
    ]);

    const parsed = JSON.parse(sinksJson) as PactlSink[];
    const defaultSink = defaultSinkRaw.trim() || null;

    const sinks = parsed
      .filter((sink) => !EXCLUDED_SINK_PATTERN.test(sink.description))
      .map((sink) => ({
        name: sink.name,
        description: sink.description,
        state: sink.state,
        isDefault: sink.name === defaultSink,
      }));

    return { sinks, defaultSink };
  }

  /**
   * 取得目前狀態;refresh=false 時允許使用 SINK_CACHE_TTL_MS 內的快取。
   * 快取更新時若偵測到 default sink 或 sink 清單變更(例如 host watcher
   * 切了系統輸出),會廣播 audio_output 讓所有 WebUI 即時同步。
   */
  async getStatus(options?: { refresh?: boolean }): Promise<AudioOutputStatus> {
    if (!this.supported) {
      return this.buildStatus();
    }

    const now = Date.now();
    const cacheValid =
      !options?.refresh && now - this.cacheTimestamp < SINK_CACHE_TTL_MS;

    if (!cacheValid) {
      const previousDefault = this.cachedDefaultSink;
      const previousNames = this.cachedSinks.map((s) => s.name).join("\n");

      const { sinks, defaultSink } = await this.fetchSinks();
      this.cachedSinks = sinks;
      this.cachedDefaultSink = defaultSink;
      const hadSnapshot = this.cacheTimestamp !== 0;
      this.cacheTimestamp = now;

      const changed =
        defaultSink !== previousDefault ||
        sinks.map((s) => s.name).join("\n") !== previousNames;

      if (hadSnapshot && changed) {
        log.info("Audio output state changed externally", {
          defaultSink,
          sinkCount: sinks.length,
        });
        this.emitChange(this.buildStatus());
      }
    }

    return this.buildStatus();
  }

  private buildStatus(): AudioOutputStatus {
    return {
      supported: this.supported,
      platform: process.platform,
      mode: this.mode,
      defaultSink: this.cachedDefaultSink,
      sinks: this.cachedSinks,
    };
  }

  /**
   * 切回「跟隨 macOS 系統輸出」:只切旗標,實際對齊由 host watcher
   * (deploy/audio-follow)在下一輪輪詢完成
   */
  async setSystemMode(): Promise<AudioOutputStatus> {
    this.assertSupported();
    this.mode = "system";
    log.info("Audio output mode set to system (host watcher will align)");
    const status = await this.getStatus({ refresh: true });
    this.emitChange(status);
    return status;
  }

  /**
   * 手動選擇輸出 sink:set-default-sink 覆蓋未來串流(含 crossfade 的
   * standby mpv session),再把現有 mpv sink-input 即時搬過去
   */
  async setManualSink(sinkName: string): Promise<AudioOutputStatus> {
    this.assertSupported();

    const { sinks } = await this.fetchSinks();
    const target = sinks.find((sink) => sink.name === sinkName);
    if (!target) {
      throw new AudioOutputError(
        `Sink not found: ${sinkName}`,
        "SINK_NOT_FOUND",
      );
    }

    await this.pactl(["set-default-sink", sinkName]);
    await this.moveMpvInputs(sinkName);

    this.mode = "manual";
    log.info("Audio output switched manually", {
      sink: sinkName,
      description: target.description,
    });

    const status = await this.getStatus({ refresh: true });
    this.emitChange(status);
    return status;
  }

  private async moveMpvInputs(sinkName: string): Promise<void> {
    const inputsJson = await this.pactl(["--format=json", "list", "sink-inputs"]);
    const inputs = JSON.parse(inputsJson) as PactlSinkInput[];

    const mpvInputs = inputs.filter((input) => {
      const props = input.properties ?? {};
      const binary = props["application.process.binary"] ?? "";
      const appName = props["application.name"] ?? "";
      return binary === "mpv" || appName.toLowerCase().includes("mpv");
    });

    for (const input of mpvInputs) {
      try {
        await this.pactl(["move-sink-input", String(input.index), sinkName]);
      } catch (error) {
        // 串流可能在列舉與搬移之間結束(如 crossfade 收尾),不視為致命錯誤
        log.warn("Failed to move sink-input (stream may have ended)", {
          inputIndex: input.index,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.debug("Moved mpv sink-inputs", {
      moved: mpvInputs.length,
      total: inputs.length,
      sink: sinkName,
    });
  }

  private assertSupported(): void {
    if (!this.supported) {
      throw new AudioOutputError(
        "Audio output switching is only supported in the container (PulseAudio) deployment; native macOS follows the system output automatically",
        "NOT_SUPPORTED",
      );
    }
  }
}

let audioOutputService: AudioOutputService | null = null;

export function getAudioOutputService(): AudioOutputService {
  if (!audioOutputService) {
    audioOutputService = new AudioOutputService();
  }
  return audioOutputService;
}
