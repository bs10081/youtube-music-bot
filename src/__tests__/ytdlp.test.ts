import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMpvYtdlRawOptions,
  getYtDlpCliArgs,
  getYtDlpCookiesStatus,
  getYtDlpExecutable,
  getYtDlpExtractorArgs,
  getYtDlpMetadataArgs,
  parseYtDlpStreamUrlOutput,
} from "../utils/ytdlp.ts";

const ORIGINAL_ENV = { ...process.env };
const tempDirs: string[] = [];

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

function createTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "youtube-music-bot-ytdlp-"));
  tempDirs.push(path);
  return path;
}

afterEach(() => {
  resetEnv();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("yt-dlp utilities", () => {
  test("should resolve executable from env with YTDLP_PATH precedence", () => {
    process.env.YTDLP_PATH = "/opt/bin/yt-dlp-custom";
    process.env.YT_DLP_PATH = "/opt/bin/yt-dlp-legacy";

    expect(getYtDlpExecutable()).toBe("/opt/bin/yt-dlp-custom");

    process.env.YTDLP_PATH = "";

    expect(getYtDlpExecutable()).toBe("/opt/bin/yt-dlp-legacy");
  });

  test("should use default extractor args unless overridden", () => {
    delete process.env.YTDLP_EXTRACTOR_ARGS;

    expect(getYtDlpExtractorArgs()).toBe("youtube:player_client=default");

    process.env.YTDLP_EXTRACTOR_ARGS = "youtube:player_client=web";

    expect(getYtDlpExtractorArgs()).toBe("youtube:player_client=web");
  });

  test("should migrate the retired profile from existing containers on every extraction path", () => {
    process.env.YTDLP_EXTRACTOR_ARGS = " youtube:player_client=android_vr ";
    delete process.env.YTDLP_COOKIES_FILE;

    expect(getYtDlpExtractorArgs()).toBe("youtube:player_client=default");
    for (const args of [
      getYtDlpCliArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      getYtDlpMetadataArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ]) {
      expect(args[args.indexOf("--extractor-args") + 1]).toBe(
        "youtube:player_client=default",
      );
    }
    expect(getMpvYtdlRawOptions()).toEqual([
      "extractor-args=[youtube:player_client=default]",
    ]);
  });

  test("should preserve deliberate custom client settings", () => {
    process.env.YTDLP_EXTRACTOR_ARGS = "youtube:player_client=web,default;skip=hls";
    expect(getYtDlpExtractorArgs()).toBe("youtube:player_client=web,default;skip=hls");
  });

  test("should report cookies file readability", () => {
    const dir = createTempDir();
    const cookiesPath = join(dir, "cookies.txt");
    process.env.YTDLP_COOKIES_FILE = cookiesPath;

    expect(getYtDlpCookiesStatus()).toMatchObject({
      configured: true,
      path: cookiesPath,
      readable: false,
    });

    writeFileSync(cookiesPath, "# Netscape HTTP Cookie File\n");

    expect(getYtDlpCookiesStatus()).toEqual({
      configured: true,
      path: cookiesPath,
      readable: true,
    });
  });

  test("should include extractor args and readable cookies in CLI args", () => {
    const dir = createTempDir();
    const cookiesPath = join(dir, "cookies.txt");
    writeFileSync(cookiesPath, "# Netscape HTTP Cookie File\n");
    process.env.YTDLP_COOKIES_FILE = cookiesPath;
    process.env.YTDLP_EXTRACTOR_ARGS = "youtube:player_client=web";

    expect(getYtDlpCliArgs("https://example.com/watch?v=1")).toEqual([
      "--no-warnings",
      "--no-playlist",
      "-g",
      "-f",
      "bestaudio[format_id!$=-drc]/bestaudio/best",
      "--extractor-args",
      "youtube:player_client=web",
      "--cookies",
      cookiesPath,
      "https://example.com/watch?v=1",
    ]);
    expect(getMpvYtdlRawOptions()).toEqual([
      "extractor-args=[youtube:player_client=web]",
      `cookies=${cookiesPath}`,
    ]);
  });

  test("should prefer non-DRC audio formats while retaining bestaudio fallback", () => {
    const args = getYtDlpCliArgs("https://example.com/watch?v=1");
    const formatIndex = args.indexOf("-f");

    expect(formatIndex).toBeGreaterThanOrEqual(0);
    expect(args[formatIndex + 1]).toBe(
      "bestaudio[format_id!$=-drc]/bestaudio/best",
    );
  });

  test("should parse the last non-empty playable URL from yt-dlp output", () => {
    expect(
      parseYtDlpStreamUrlOutput(
        "\nhttps://example.com/video\nhttps://example.com/audio\n",
      ),
    ).toBe("https://example.com/audio");
  });

  test("should reject empty, invalid, or unsupported stream URLs", () => {
    expect(() => parseYtDlpStreamUrlOutput("")).toThrow(
      "yt-dlp did not return a playable URL",
    );
    expect(() => parseYtDlpStreamUrlOutput("not-a-url")).toThrow(
      "yt-dlp returned an invalid playable URL",
    );
    expect(() => parseYtDlpStreamUrlOutput("file:///tmp/audio.webm")).toThrow(
      "unsupported playable URL protocol",
    );
  });
});
