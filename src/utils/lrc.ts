import type { LyricLine } from "../types/index.ts";

/**
 * 將 LyricLine[] 反向序列化為 LRC 文字(music.service parseLrc 的逆運算)。
 * 輸出 [mm:ss.mmm] 三位毫秒以保留 parse 時擷取的完整精度;
 * 標準 LRC parser(含 Folia 端)接受 2 或 3 位小數。
 */
export function serializeLrc(lines: LyricLine[]): string {
  return lines
    .map((line) => {
      const totalMs = Math.round(Math.max(0, line.time) * 1000);
      const minutes = Math.floor(totalMs / 60_000);
      const seconds = Math.floor((totalMs % 60_000) / 1000);
      const millis = totalMs % 1000;
      const mm = String(minutes).padStart(2, "0");
      const ss = String(seconds).padStart(2, "0");
      const mmm = String(millis).padStart(3, "0");
      return `[${mm}:${ss}.${mmm}]${line.text}`;
    })
    .join("\n");
}
