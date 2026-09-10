import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPlayerServiceForTests, getPlayerService } from "../services/player.service.ts";

type StartupPlayer = {
  playbackConfirmationTimeoutMs: number;
  connectSessionIpc: (session: unknown) => Promise<void>;
  handleIpcMessage: (session: unknown, data: string) => void;
};

let tempDir: string;
const originalMpvPath = process.env.MPV_PATH;
beforeEach(() => {
  __resetPlayerServiceForTests();
  tempDir = mkdtempSync(join(tmpdir(), "mpv-startup-test-"));
  const executable = join(tempDir, "mpv");
  writeFileSync(executable, "#!/usr/bin/env bun\nsetInterval(() => {}, 1000);\n", { mode: 0o755 });
  process.env.MPV_PATH = executable;
});
afterEach(() => {
  __resetPlayerServiceForTests();
  if (originalMpvPath === undefined) delete process.env.MPV_PATH;
  else process.env.MPV_PATH = originalMpvPath;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("PlayerService startup confirmation", () => {
  test("rejects instead of reporting success when IPC cannot connect", async () => {
    const player = getPlayerService();
    const internal = player as unknown as StartupPlayer;
    internal.connectSessionIpc = async () => { throw new Error("IPC unavailable"); };
    await expect(player.playUrl("https://example.com/audio")).rejects.toThrow("IPC unavailable");
    expect(player.isCurrentlyPlaying()).toBe(false);
  });

  test("does not lose progress received during the initial IPC connection", async () => {
    const player = getPlayerService();
    const internal = player as unknown as StartupPlayer;
    internal.playbackConfirmationTimeoutMs = 500;
    internal.connectSessionIpc = async (session) => {
      internal.handleIpcMessage(session, '{"event":"property-change","name":"time-pos","data":0.25}\n');
    };
    await player.playUrl("https://example.com/audio");
    expect(player.isCurrentlyPlaying()).toBe(true);
  });
});
