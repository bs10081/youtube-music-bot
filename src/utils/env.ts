import { existsSync } from "node:fs";
import { log } from "./logger.ts";

const KNOWN_LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"];

/**
 * 啟動時檢查環境變數設定。
 * 這個服務定位是 LAN 家用設備,設定有誤時以警告提示並沿用預設值,不中斷啟動。
 */
export function validateEnvironment(): void {
  const port = process.env.PORT?.trim();
  if (port && !Number.isFinite(Number.parseInt(port, 10))) {
    log.warn("PORT is not a valid number; falling back to 3000", { port });
  }

  const ytdlpTimeout = process.env.YTDLP_TIMEOUT_MS?.trim();
  if (ytdlpTimeout && !Number.isFinite(Number.parseInt(ytdlpTimeout, 10))) {
    log.warn("YTDLP_TIMEOUT_MS is not a valid number; using default", {
      ytdlpTimeoutMs: ytdlpTimeout,
    });
  }

  const logLevel = process.env.LOG_LEVEL?.trim().toUpperCase();
  if (logLevel && !KNOWN_LOG_LEVELS.includes(logLevel)) {
    log.warn("Unknown LOG_LEVEL; using INFO", { logLevel });
  }

  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookiesFile && !existsSync(cookiesFile)) {
    log.warn("YTDLP_COOKIES_FILE is set but the file does not exist", {
      cookiesFile,
    });
  }

  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  if (corsOrigin === "*") {
    log.warn(
      'CORS_ORIGIN="*" is redundant; leave it unset for open access without credentials',
    );
  }
}
