import { describe, expect, test } from "bun:test";
import type { LyricLine, PlaybackState, Track } from "../types/index.ts";
import { serializeLrc } from "../utils/lrc.ts";
import {
  buildFoliaLyric,
  shouldEmitReplay,
  toFoliaPauseState,
  toFoliaProgressMs,
  toFoliaTrack,
} from "../websocket/folia-bridge.ts";

// 與 music.service parseLrc 相同的 regex,驗證 serializeLrc 可被逆向解析
const LRC_LINE_REGEX = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

function parseLrcLine(line: string): LyricLine | null {
  const match = line.match(LRC_LINE_REGEX);
  if (!match) {
    return null;
  }
  const minutes = Number.parseInt(match[1]!, 10);
  const seconds = Number.parseInt(match[2]!, 10);
  const fraction = Number.parseInt(match[3]!.padEnd(3, "0"), 10);
  return {
    time: minutes * 60 + seconds + fraction / 1000,
    text: match[4]!,
  };
}

const baseTrack: Track = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  duration: 213,
  thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  album: { id: "alb1", name: "Whenever You Need Somebody" },
};

const baseState: PlaybackState = {
  isPlaying: true,
  currentTrack: baseTrack,
  position: 42.5,
  duration: 213,
  volume: 80,
  queue: [],
  radioEnabled: false,
  lastPlayedTrack: null,
  playbackSettings: {
    crossfadeEnabled: true,
    crossfadeDurationSeconds: 4,
    volumeNormalizationEnabled: true,
  },
};

describe("serializeLrc", () => {
  test("should emit [mm:ss.mmm] lines parseable by the parseLrc regex", () => {
    const lines: LyricLine[] = [
      { time: 12.34, text: "First line" },
      { time: 62.567, text: "Second line" },
    ];
    const lrc = serializeLrc(lines);
    expect(lrc).toBe("[00:12.340]First line\n[01:02.567]Second line");

    const roundTripped = lrc.split("\n").map(parseLrcLine);
    expect(roundTripped[0]?.time).toBeCloseTo(12.34, 3);
    expect(roundTripped[1]?.time).toBeCloseTo(62.567, 3);
    expect(roundTripped[1]?.text).toBe("Second line");
  });

  test("should carry rounding into seconds instead of emitting 1000ms", () => {
    // 61.9995 秒:毫秒四捨五入後必須進位為 [01:02.000],不能出現 .1000
    expect(serializeLrc([{ time: 61.9995, text: "edge" }])).toBe(
      "[01:02.000]edge",
    );
  });

  test("should clamp negative times to zero and handle empty input", () => {
    expect(serializeLrc([{ time: -3, text: "neg" }])).toBe("[00:00.000]neg");
    expect(serializeLrc([])).toBe("");
  });
});

describe("toFoliaTrack", () => {
  test("should map fields and keep duration in seconds", () => {
    expect(toFoliaTrack(baseTrack)).toEqual({
      author: "Rick Astley",
      title: "Never Gonna Give You Up",
      album: "Whenever You Need Somebody",
      cover: "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      // Folia 對 <10000 的 duration 自動視為秒並 ×1000,這裡不可預轉毫秒
      duration: 213,
      id: "dQw4w9WgXcQ",
    });
  });

  test("should omit album and cover when absent", () => {
    const minimal: Track = {
      videoId: "abc",
      title: "T",
      artist: "A",
      duration: 10,
    };
    const mapped = toFoliaTrack(minimal);
    expect("album" in mapped).toBe(false);
    expect("cover" in mapped).toBe(false);
  });
});

describe("toFoliaPauseState", () => {
  test("should invert isPlaying and keep position in seconds", () => {
    expect(toFoliaPauseState(baseState)).toEqual({
      hasSong: true,
      isPaused: false,
      seekbarCurrentPosition: 42.5,
      statePercent: 42.5 / 213,
    });
  });

  test("should guard statePercent against zero duration", () => {
    const idle: PlaybackState = {
      ...baseState,
      isPlaying: false,
      currentTrack: null,
      position: 0,
      duration: 0,
    };
    expect(toFoliaPauseState(idle)).toEqual({
      hasSong: false,
      isPaused: true,
      seekbarCurrentPosition: 0,
      statePercent: 0,
    });
  });

  test("should clamp statePercent to 1 when position overshoots", () => {
    const overshoot: PlaybackState = { ...baseState, position: 999 };
    expect(toFoliaPauseState(overshoot).statePercent).toBe(1);
  });
});

describe("toFoliaProgressMs", () => {
  test("should convert seconds to rounded milliseconds", () => {
    expect(toFoliaProgressMs(42.5)).toBe(42500);
    expect(toFoliaProgressMs(0.0004)).toBe(0);
    expect(toFoliaProgressMs(-1)).toBe(0);
  });
});

describe("buildFoliaLyric", () => {
  test("should wrap serialized LRC with metadata", () => {
    const lyric = buildFoliaLyric(baseTrack, [{ time: 1, text: "hi" }]);
    expect(lyric).toEqual({
      source: "lrclib",
      title: "Never Gonna Give You Up",
      author: "Rick Astley",
      hasLyric: true,
      hasTranslatedLyric: false,
      hasKaraokeLyric: false,
      lrc: "[00:01.000]hi",
    });
  });

  test("should mark hasLyric=false with null lrc for empty lines", () => {
    const lyric = buildFoliaLyric(baseTrack, []);
    expect(lyric.hasLyric).toBe(false);
    expect(lyric.lrc).toBeNull();
  });
});

describe("shouldEmitReplay", () => {
  test.each([
    // [previousMs, nextMs, sameTrack, expected]
    [30000, 5000, true, true], // 倒退 25s → Replay
    [30000, 28500, true, false], // 抖動 1.5s(< 2s 遲滯)→ 不觸發
    [30000, 27999, true, true], // 恰好超過 2s 遲滯 → Replay
    [30000, 28000, true, false], // 恰好等於遲滯邊界 → 不觸發
    [30000, 31000, true, false], // 正常前進 → 不觸發
    [30000, 0, false, false], // 換歌(不同 track)由 onStateChange 負責 Replay
  ])(
    "prev=%dms next=%dms sameTrack=%p → %p",
    (previousMs, nextMs, sameTrack, expected) => {
      expect(shouldEmitReplay(previousMs, nextMs, sameTrack)).toBe(expected);
    },
  );
});
