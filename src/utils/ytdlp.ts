import { accessSync, constants, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEFAULT_EXTRACTOR_ARGS = "youtube:player_client=default";
const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const NON_DRC_AUDIO_FORMAT_SELECTOR =
  "bestaudio[format_id!$=-drc]/bestaudio/best";

export type YtDlpCookiesStatus = {
  configured: boolean;
  path: string | null;
  readable: boolean;
  error?: string;
};

export type YtDlpRuntimeProbe = {
  available: boolean;
  executable: string;
  version?: string;
  extractorArgs: string;
  cookiesConfigured: boolean;
  cookiesReadable: boolean;
  cookiesPath: string | null;
  error?: string;
};

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getYtDlpExecutable(): string {
  return (
    normalizeEnvValue(process.env.YTDLP_PATH) ??
    normalizeEnvValue(process.env.YT_DLP_PATH) ??
    (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")
  );
}

export function getYtDlpExtractorArgs(): string {
  const configured = normalizeEnvValue(process.env.YTDLP_EXTRACTOR_ARGS);
  // Older Compose deployments retain this retired profile after an image update.
  // Migrate only the old exact default; preserve deliberate custom profiles.
  if (configured === "youtube:player_client=android_vr") {
    return DEFAULT_EXTRACTOR_ARGS;
  }
  return configured ?? DEFAULT_EXTRACTOR_ARGS;
}

export function getYtDlpCommandTimeoutMs(): number {
  const configuredTimeout = Number.parseInt(
    normalizeEnvValue(process.env.YTDLP_TIMEOUT_MS) ?? "",
    10,
  );

  if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
    return configuredTimeout;
  }

  return DEFAULT_COMMAND_TIMEOUT_MS;
}

export function getYtDlpCookiesStatus(): YtDlpCookiesStatus {
  const cookiePath = normalizeEnvValue(process.env.YTDLP_COOKIES_FILE);

  if (!cookiePath) {
    return {
      configured: false,
      path: null,
      readable: false,
    };
  }

  if (!existsSync(cookiePath)) {
    return {
      configured: true,
      path: cookiePath,
      readable: false,
      error: "configured cookies file does not exist",
    };
  }

  try {
    accessSync(cookiePath, constants.R_OK);
  } catch (error) {
    return {
      configured: true,
      path: cookiePath,
      readable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    configured: true,
    path: cookiePath,
    readable: true,
  };
}

export function getYtDlpCookiesPath(): string | null {
  const cookies = getYtDlpCookiesStatus();
  return cookies.readable ? cookies.path : null;
}

export function getYtDlpCliArgs(url: string): string[] {
  const args = [
    "--no-warnings",
    "--no-playlist",
    "-g",
    "-f",
    NON_DRC_AUDIO_FORMAT_SELECTOR,
  ];

  const extractorArgs = getYtDlpExtractorArgs();
  if (extractorArgs) {
    args.push("--extractor-args", extractorArgs);
  }

  const cookiesPath = getYtDlpCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  args.push(url);
  return args;
}

export function parseYtDlpStreamUrlOutput(stdout: string): string {
  const urls = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const streamUrl = urls[urls.length - 1];

  if (!streamUrl) {
    throw new Error("yt-dlp did not return a playable URL");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(streamUrl);
  } catch {
    throw new Error("yt-dlp returned an invalid playable URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `yt-dlp returned an unsupported playable URL protocol: ${parsedUrl.protocol}`,
    );
  }

  return streamUrl;
}

export function getYtDlpFailureHint(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("sign in to confirm") ||
    normalized.includes("confirm you're not a bot") ||
    normalized.includes("not a bot") ||
    normalized.includes("cookies")
  ) {
    return "YouTube may require cookies for this IP; configure YTDLP_COOKIES_FILE with a readable cookies.txt file.";
  }

  return null;
}

export function probeYtDlpRuntime(): YtDlpRuntimeProbe {
  const executable = getYtDlpExecutable();
  const cookies = getYtDlpCookiesStatus();
  const probe = spawnSync(executable, ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  const base = {
    executable,
    extractorArgs: getYtDlpExtractorArgs(),
    cookiesConfigured: cookies.configured,
    cookiesReadable: cookies.readable,
    cookiesPath: cookies.path,
  };

  if (probe.error) {
    return {
      ...base,
      available: false,
      error: probe.error.message,
    };
  }

  if (probe.status !== 0) {
    return {
      ...base,
      available: false,
      error:
        probe.stderr.trim() ||
        probe.stdout.trim() ||
        `exited with code ${probe.status ?? "unknown"}`,
    };
  }

  const version =
    `${probe.stdout}`.trim().split(/\r?\n/).find(Boolean) ?? "unknown";

  return {
    ...base,
    available: true,
    version,
    error: cookies.error,
  };
}

export function getYtDlpMetadataArgs(
  url: string,
  options: {
    flatPlaylist?: boolean;
    maxPlaylistItems?: number;
    noPlaylist?: boolean;
  } = {},
): string[] {
  const args = ["--no-warnings", "--dump-single-json"];

  if (options.flatPlaylist) {
    args.push("--flat-playlist");
  }

  if (typeof options.maxPlaylistItems === "number" && options.maxPlaylistItems > 0) {
    args.push("--playlist-items", `1:${options.maxPlaylistItems}`);
  }

  if (options.noPlaylist) {
    args.push("--no-playlist");
  }

  const extractorArgs = getYtDlpExtractorArgs();
  if (extractorArgs) {
    args.push("--extractor-args", extractorArgs);
  }

  const cookiesPath = getYtDlpCookiesPath();
  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  args.push(url);
  return args;
}

export function getMpvYtdlRawOptions(): string[] {
  const rawOptions: string[] = [];
  const extractorArgs = getYtDlpExtractorArgs();

  if (extractorArgs) {
    rawOptions.push(`extractor-args=[${extractorArgs}]`);
  }

  const cookiesPath = getYtDlpCookiesPath();
  if (cookiesPath) {
    rawOptions.push(`cookies=${cookiesPath}`);
  }

  return rawOptions;
}
