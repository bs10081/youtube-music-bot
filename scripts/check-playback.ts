import { checkMediaRange, runProbeCommand } from "../src/utils/playback-probe.ts";
import { getMpvExecutable } from "../src/utils/runtime-dependencies.ts";
import {
  getYtDlpCliArgs, getYtDlpCommandTimeoutMs, getYtDlpExecutable,
  getYtDlpExtractorArgs, parseYtDlpStreamUrlOutput,
} from "../src/utils/ytdlp.ts";

// Run explicitly on the intended egress IP. This is not a liveness healthcheck.
const videoIds = process.argv.slice(2);
if (!videoIds.length || videoIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))) {
  console.error("Usage: bun run check:playback <11-character video-id> [...video-ids]");
  process.exit(2);
}
const executable = getYtDlpExecutable();
const version = runProbeCommand("yt-dlp", executable, ["--version"], 5000).trim();
console.log(JSON.stringify({ ytDlpVersion: version, extractorArgs: getYtDlpExtractorArgs() }));
let failed = false;
for (const videoId of videoIds) {
  try {
    const output = runProbeCommand("yt-dlp", executable,
      getYtDlpCliArgs(`https://www.youtube.com/watch?v=${videoId}`), getYtDlpCommandTimeoutMs());
    const url = parseYtDlpStreamUrlOutput(output);
    const parsed = new URL(url);
    const media = await checkMediaRange(url);
    runProbeCommand("mpv", getMpvExecutable(), [
      "--no-config", "--no-video", "--ao=null", "--ytdl=no", "--really-quiet", "--end=3", url,
    ], 30_000);
    console.log(JSON.stringify({ videoId, ok: true,
      client: parsed.searchParams.get("c"), itag: parsed.searchParams.get("itag"),
      ...media, mpvExitCode: 0,
    }));
  } catch (error) {
    failed = true;
    // Only our bounded status messages, never child stderr or the signed URL.
    const message = error instanceof Error ? error.message : "Playback check failed";
    console.error(JSON.stringify({ videoId, ok: false, error: message.replace(/https?:\/\/\S+/g, "[URL omitted]") }));
  }
}
process.exit(failed ? 1 : 0);
