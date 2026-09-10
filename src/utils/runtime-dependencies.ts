import { spawnSync } from "node:child_process";
import { log } from "./logger.ts";
import { probeYtDlpRuntime } from "./ytdlp.ts";

type RuntimeDependency = {
  name: "mpv" | "deno";
  executable: string;
  required: boolean;
  purpose: string;
};

export type DependencyProbeResult = {
  available: boolean;
  executable: string;
  version?: string;
  error?: string;
};

export type YtDlpDependencyProbeResult = DependencyProbeResult & {
  extractorArgs: string;
  cookiesConfigured: boolean;
  cookiesReadable: boolean;
};

export type RuntimeDependencyStatus = {
  mpv: DependencyProbeResult;
  deno: DependencyProbeResult;
  ytDlp: YtDlpDependencyProbeResult;
};

export function getMpvExecutable(): string {
  const configuredPath = process.env.MPV_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  return process.platform === "win32" ? "mpv.exe" : "mpv";
}

function probeExecutable(executable: string): DependencyProbeResult {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });

  if (result.error) {
    return {
      available: false,
      executable,
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      available: false,
      executable,
      error:
        result.stderr.trim() ||
        result.stdout.trim() ||
        `exited with code ${result.status ?? "unknown"}`,
    };
  }

  const versionLine =
    `${result.stdout}`.trim().split(/\r?\n/).find(Boolean) ?? "unknown";

  return {
    available: true,
    executable,
    version: versionLine,
  };
}

export function getRuntimeDependencyStatus(): RuntimeDependencyStatus {
  const mpv = probeExecutable(getMpvExecutable());
  const ytDlp = probeYtDlpRuntime();

  return {
    mpv,
    deno: probeExecutable("deno"),
    ytDlp: {
      available: ytDlp.available,
      executable: ytDlp.executable,
      version: ytDlp.version,
      extractorArgs: ytDlp.extractorArgs,
      cookiesConfigured: ytDlp.cookiesConfigured,
      cookiesReadable: ytDlp.cookiesReadable,
      error: ytDlp.error,
    },
  };
}

export function logRuntimeDependencyStatus(): void {
  const dependencies: RuntimeDependency[] = [
    { name: "deno", executable: "deno", required: true, purpose: "YouTube JavaScript challenges (EJS)" },
    {
      name: "mpv",
      executable: getMpvExecutable(),
      required: true,
      purpose: "audio playback",
    },
  ];

  for (const dependency of dependencies) {
    const result = probeExecutable(dependency.executable);

    if (result.available) {
      log.info("Runtime dependency available", {
        dependency: dependency.name,
        executable: dependency.executable,
        version: result.version,
        purpose: dependency.purpose,
      });
      continue;
    }

    const context = {
      dependency: dependency.name,
      executable: dependency.executable,
      purpose: dependency.purpose,
      error: result.error,
    };

    if (dependency.required) {
      log.error("Required runtime dependency missing", context);
      continue;
    }

    log.warn("Optional runtime dependency missing", context);
  }

  const ytDlp = probeYtDlpRuntime();
  if (ytDlp.available) {
    log.info("Runtime dependency available", {
      dependency: "yt-dlp",
      executable: ytDlp.executable,
      version: ytDlp.version,
      purpose: "YouTube stream extraction",
      extractorArgs: ytDlp.extractorArgs,
      cookiesConfigured: ytDlp.cookiesConfigured,
      cookiesReadable: ytDlp.cookiesReadable,
    });
  } else {
    log.error("Required runtime dependency missing", {
      dependency: "yt-dlp",
      executable: ytDlp.executable,
      purpose: "YouTube stream extraction",
      error: ytDlp.error,
      extractorArgs: ytDlp.extractorArgs,
      cookiesConfigured: ytDlp.cookiesConfigured,
      cookiesReadable: ytDlp.cookiesReadable,
    });
  }

  if (ytDlp.cookiesConfigured && !ytDlp.cookiesReadable) {
    log.warn("Configured yt-dlp cookies file is not readable", {
      dependency: "yt-dlp",
      cookiesPath: ytDlp.cookiesPath,
      error: ytDlp.error,
    });
  }
}
