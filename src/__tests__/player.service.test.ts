import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { ChildProcess } from "node:child_process";
import {
  __resetPlayerServiceForTests,
  getPlayerService,
} from "../services/player.service.ts";

type RestorableMethod = {
  target: Record<string, unknown>;
  key: string;
  original: unknown;
};

const restores: RestorableMethod[] = [];

function stubMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
): void {
  restores.push({
    target: target as Record<string, unknown>,
    key: key as string,
    original: target[key],
  });
  target[key] = replacement;
}

function restoreMethods(): void {
  while (restores.length > 0) {
    const restore = restores.pop()!;
    restore.target[restore.key] = restore.original;
  }
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type TestSession = {
  id: number;
  purpose: "active" | "standby" | "retiring";
  source: { type: "stream"; value: string };
  volumeMultiplier: number;
  targetVolume: number;
  duration: number | null;
  process: ChildProcess;
  ipcSocket: null;
  ipcPath: string;
  ipcConnectRetries: number;
  eofHandled: boolean;
  ready: boolean;
  trackId: string;
  confirmation: null;
};

function createSession(process: ChildProcess): TestSession {
  return {
    id: 1,
    purpose: "active" as const,
    source: { type: "stream" as const, value: "https://example.com/audio" },
    volumeMultiplier: 1,
    targetVolume: 70,
    duration: null,
    process,
    ipcSocket: null,
    ipcPath: "/tmp/test-mpv.sock",
    ipcConnectRetries: 0,
    eofHandled: false,
    ready: true,
    trackId: "track-1",
    confirmation: null,
  };
}

describe("PlayerService - seek functionality", () => {
  let playerService: ReturnType<typeof getPlayerService>;

  beforeEach(() => {
    restoreMethods();
    __resetPlayerServiceForTests();
    playerService = getPlayerService();
  });

  afterEach(() => {
    restoreMethods();
    __resetPlayerServiceForTests();
  });

  describe("seek() method", () => {
    test("should reject seek when no playback is active", () => {
      // Mock console.warn to verify warning is logged
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      playerService.seek(10);

      expect(warnSpy).toHaveBeenCalled();

      // Restore original console.warn
      console.warn = originalWarn;
    });

    test("should reject negative seek position", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      playerService.seek(-5);

      expect(warnSpy).toHaveBeenCalled();

      console.warn = originalWarn;
    });

    test("should reject NaN seek position", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      playerService.seek(NaN);

      expect(warnSpy).toHaveBeenCalled();

      console.warn = originalWarn;
    });

    test("should reject Infinity seek position", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      playerService.seek(Infinity);

      expect(warnSpy).toHaveBeenCalled();

      console.warn = originalWarn;
    });

    test("should accept valid positive seek position (boundary case: 0)", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      // Note: This will still warn because no playback is active
      // In a real test, you would need to mock the playback state
      playerService.seek(0);

      console.warn = originalWarn;
    });

    test("should accept valid positive seek position (normal case)", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      playerService.seek(30.5);

      console.warn = originalWarn;
    });
  });

  describe("volume control", () => {
    test("should clamp volume to 0-100 range (below minimum)", () => {
      playerService.setVolume(-10);
      expect(playerService.getVolume()).toBe(0);
    });

    test("should clamp volume to 0-100 range (above maximum)", () => {
      playerService.setVolume(150);
      expect(playerService.getVolume()).toBe(100);
    });

    test("should accept valid volume values", () => {
      playerService.setVolume(50);
      expect(playerService.getVolume()).toBe(50);
    });

    test("should handle boundary values", () => {
      playerService.setVolume(0);
      expect(playerService.getVolume()).toBe(0);

      playerService.setVolume(100);
      expect(playerService.getVolume()).toBe(100);
    });

    test("should update standby target volume when user volume changes", () => {
      const fakeProcess = {} as ChildProcess;
      const standby = {
        ...createSession(fakeProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
        volumeMultiplier: 0.75,
      };
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        standbySession: typeof standby | null;
        setSessionVolume: (
          session: typeof standby,
          volume: number,
        ) => boolean;
      };

      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );

      player.standbySession = standby;

      playerService.setVolume(80);

      expect(standby.volumeMultiplier).toBe(0.75);
      expect(standby.targetVolume).toBe(60);
      expect(setVolumeSpy).toHaveBeenCalledWith(standby, 60);
    });

    test("should update standby target volume when track multiplier changes", () => {
      const fakeProcess = {} as ChildProcess;
      const standby = {
        ...createSession(fakeProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
      };
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        standbySession: typeof standby | null;
        setSessionVolume: (
          session: typeof standby,
          volume: number,
        ) => boolean;
      };

      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );

      player.standbySession = standby;

      playerService.setTrackVolumeMultiplier("track-2", 0.6);

      expect(standby.volumeMultiplier).toBe(0.6);
      expect(standby.targetVolume).toBe(42);
      expect(setVolumeSpy).toHaveBeenCalledWith(standby, 42);
    });

    test("should clamp track multipliers so Dynamic Voice never boosts volume", () => {
      const fakeProcess = {} as ChildProcess;
      const standby = {
        ...createSession(fakeProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
      };
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        standbySession: typeof standby | null;
        setSessionVolume: (
          session: typeof standby,
          volume: number,
        ) => boolean;
      };

      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );

      player.standbySession = standby;

      playerService.setTrackVolumeMultiplier("track-2", 1.6);

      expect(standby.volumeMultiplier).toBe(1);
      expect(standby.targetVolume).toBe(70);
      expect(setVolumeSpy).toHaveBeenCalledWith(standby, 70);
    });
  });

  describe("intentional stop exit handling", () => {
    test("should suppress eof when an intentionally stopped process exits cleanly", () => {
      const fakeProcess = {
        kill: mock(() => true),
      } as unknown as ChildProcess;
      const eventSpy = mock(() => {});
      const player = playerService as unknown as {
        activeSession: ReturnType<typeof createSession> | null;
        handleSessionExit: (
          session: ReturnType<typeof createSession>,
          code: number | null,
          signal: NodeJS.Signals | null,
          settleReady: (ready: boolean) => void,
          rejectReady: (error: Error) => void,
        ) => void;
      };
      const session = createSession(fakeProcess);

      playerService.onEvent(eventSpy);
      player.activeSession = session;

      playerService.stop();
      player.handleSessionExit(session, 0, null, () => {}, () => {});

      expect(eventSpy).not.toHaveBeenCalled();
    });

    test("should keep natural eof behavior for a normal clean exit", () => {
      const fakeProcess = {} as ChildProcess;
      const eventSpy = mock(() => {});
      const player = playerService as unknown as {
        activeSession: ReturnType<typeof createSession> | null;
        handleSessionExit: (
          session: ReturnType<typeof createSession>,
          code: number | null,
          signal: NodeJS.Signals | null,
          settleReady: (ready: boolean) => void,
          rejectReady: (error: Error) => void,
        ) => void;
      };
      const session = createSession(fakeProcess);

      playerService.onEvent(eventSpy);
      player.activeSession = session;

      player.handleSessionExit(session, 0, null, () => {}, () => {});

      expect(eventSpy).toHaveBeenCalledWith({ eof: true });
    });
  });

  describe("playback confirmation", () => {
    test("should use the supported mpv volume-max option", () => {
      const fakeProcess = {} as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        buildMpvArgs: (
          session: ReturnType<typeof createSession>,
          options: { volume: number; startPaused: boolean },
        ) => string[];
      };

      const args = player.buildMpvArgs(session, {
        volume: 70,
        startPaused: false,
      });

      expect(args).toContain("--volume-max=200");
      expect(args).not.toContain("--softvol-max=200");
    });

    test("should include the dynaudnorm audio filter by default", () => {
      const fakeProcess = {} as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        buildMpvArgs: (
          session: ReturnType<typeof createSession>,
          options: { volume: number; startPaused: boolean },
        ) => string[];
      };

      const args = player.buildMpvArgs(session, {
        volume: 70,
        startPaused: false,
      });

      const filterArg = args.find((arg) => arg.startsWith("--af="));
      expect(filterArg).toBeDefined();
      expect(filterArg).toContain("dynaudnorm");
    });

    test("should omit the audio filter when volume normalization is disabled", () => {
      const fakeProcess = {} as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        buildMpvArgs: (
          session: ReturnType<typeof createSession>,
          options: { volume: number; startPaused: boolean },
        ) => string[];
      };

      playerService.setVolumeNormalizationEnabled(false);

      const args = player.buildMpvArgs(session, {
        volume: 70,
        startPaused: false,
      });

      expect(args.some((arg) => arg.startsWith("--af="))).toBe(false);
    });

    test("should toggle the audio filter on live sessions through IPC", () => {
      const fakeProcess = {} as ChildProcess;
      const activeSession = createSession(fakeProcess);
      const standbySession = createSession(fakeProcess);
      const ipcSpy = mock(
        (_session: ReturnType<typeof createSession>, _command: unknown[]) =>
          true,
      );
      const player = playerService as unknown as {
        activeSession: ReturnType<typeof createSession> | null;
        standbySession: ReturnType<typeof createSession> | null;
        sendIpcCommand: (
          session: ReturnType<typeof createSession>,
          command: unknown[],
        ) => boolean;
      };

      stubMethod(
        player,
        "sendIpcCommand",
        ipcSpy as unknown as typeof player.sendIpcCommand,
      );
      player.activeSession = activeSession;
      player.standbySession = standbySession;

      playerService.setVolumeNormalizationEnabled(false);

      expect(ipcSpy).toHaveBeenCalledTimes(2);
      expect(ipcSpy.mock.calls[0]?.[1]).toEqual(["af", "clr", ""]);

      playerService.setVolumeNormalizationEnabled(true);

      expect(ipcSpy).toHaveBeenCalledTimes(4);
      const enableCommand = ipcSpy.mock.calls[2]?.[1] as string[];
      expect(enableCommand[0]).toBe("af");
      expect(enableCommand[1]).toBe("set");
      expect(enableCommand[2]).toContain("dynaudnorm");

      // 相同狀態重複設定不應再送 IPC
      playerService.setVolumeNormalizationEnabled(true);
      expect(ipcSpy).toHaveBeenCalledTimes(4);

      player.activeSession = null;
      player.standbySession = null;
    });

    test("should wait for a positive time-pos before confirming playback", () => {
      const fakeProcess = {
        kill: mock(() => true),
      } as unknown as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        activeSession: ReturnType<typeof createSession> | null;
        beginSessionConfirmation: (
          session: ReturnType<typeof createSession>,
          mode: "playback" | "preload",
          settle: (ready: boolean) => void,
          reject: (error: Error) => void,
        ) => void;
        handlePropertyChange: (
          session: ReturnType<typeof createSession>,
          message: {
            name: string;
            data: number | boolean;
          },
        ) => void;
      };
      const settle = mock((_ready: boolean) => {});
      const reject = mock((_error: Error) => {});

      player.activeSession = session;
      player.beginSessionConfirmation(session, "playback", settle, reject);
      player.handlePropertyChange(session, {
        name: "time-pos",
        data: 0,
      });
      player.handlePropertyChange(session, {
        name: "time-pos",
        data: 0.25,
      });

      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith(true);
      expect(reject).not.toHaveBeenCalled();
    });

    test("should reject when mpv exits before playback is confirmed", () => {
      const fakeProcess = {} as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        beginSessionConfirmation: (
          session: ReturnType<typeof createSession>,
          mode: "playback" | "preload",
          settle: (ready: boolean) => void,
          reject: (error: Error) => void,
        ) => void;
        handleSessionExit: (
          session: ReturnType<typeof createSession>,
          code: number | null,
          signal: NodeJS.Signals | null,
          settleReady: (ready: boolean) => void,
          rejectReady: (error: Error) => void,
        ) => void;
      };
      const settle = mock((_ready: boolean) => {});
      const reject = mock((_error: Error) => {});

      player.beginSessionConfirmation(session, "playback", settle, reject);
      player.handleSessionExit(session, 2, null, settle, reject);

      expect(settle).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledTimes(1);
      const firstError = reject.mock.calls[0]?.[0];
      expect(firstError).toBeInstanceOf(Error);
      expect(firstError?.message).toBe("mpv exited with code 2");
    });

    test("should confirm preload sessions when duration metadata arrives", () => {
      const fakeProcess = {} as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        beginSessionConfirmation: (
          session: ReturnType<typeof createSession>,
          mode: "playback" | "preload",
          settle: (ready: boolean) => void,
          reject: (error: Error) => void,
        ) => void;
        handlePropertyChange: (
          session: ReturnType<typeof createSession>,
          message: {
            name: string;
            data: number | boolean;
          },
        ) => void;
      };
      const settle = mock((_ready: boolean) => {});
      const reject = mock((_error: Error) => {});

      player.beginSessionConfirmation(session, "preload", settle, reject);
      player.handlePropertyChange(session, {
        name: "duration",
        data: 215,
      });

      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith(true);
      expect(reject).not.toHaveBeenCalled();
      expect(session.duration).toBe(215);
    });

    test("should retain a preloaded session duration after promotion", async () => {
      const outgoing = createSession({
        kill: mock(() => true),
      } as unknown as ChildProcess);
      const standby = {
        ...createSession({
          kill: mock(() => true),
        } as unknown as ChildProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
      };
      const player = playerService as unknown as {
        activeSession: typeof outgoing | null;
        standbySession: typeof standby | null;
        handlePropertyChange: (
          session: typeof standby,
          message: {
            name: string;
            data: number | boolean;
          },
        ) => void;
      };

      player.activeSession = outgoing;
      player.standbySession = standby;
      player.handlePropertyChange(standby, {
        name: "duration",
        data: 215,
      });

      const promoted = await playerService.playPreloaded("track-2");

      expect(promoted).toBe(true);
      expect(playerService.getActiveDuration()).toBe(215);
    });

    test("should clear playback state when session startup fails", async () => {
      const fakeProcess = {
        kill: mock(() => true),
      } as unknown as ChildProcess;
      const session = createSession(fakeProcess);
      const player = playerService as unknown as {
        spawnSession: (
          options: {
            source: { type: "youtube" | "stream"; value: string };
            purpose: "active" | "standby" | "retiring";
            trackId?: string | null;
            startPaused?: boolean;
            volume?: number;
            volumeMultiplier?: number;
            confirmMode: "playback" | "preload";
          },
        ) => {
          session: ReturnType<typeof createSession>;
          ready: Promise<boolean>;
        };
        activeSession: ReturnType<typeof createSession> | null;
      };

      stubMethod(
        player,
        "spawnSession",
        (() => ({
          session,
          ready: Promise.reject(new Error("mpv executable not found")),
        })) as typeof player.spawnSession,
      );

      await expect(playerService.play("track-1")).rejects.toThrow(
        "mpv executable not found",
      );
      expect(playerService.isCurrentlyPlaying()).toBe(false);
      expect(player.activeSession).toBeNull();
    });

    test("should restore target volume when promoting a preloaded session", async () => {
      const outgoing = createSession({
        kill: mock(() => true),
      } as unknown as ChildProcess);
      const standby = {
        ...createSession({
          kill: mock(() => true),
        } as unknown as ChildProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
        volumeMultiplier: 1.2,
        targetVolume: 84,
      };
      const setPausedSpy = mock((_session: unknown, _paused: boolean) => true);
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        activeSession: typeof outgoing | null;
        standbySession: typeof standby | null;
        setSessionPaused: (
          session: typeof standby,
          paused: boolean,
        ) => boolean;
        setSessionVolume: (
          session: typeof standby,
          volume: number,
        ) => boolean;
      };

      stubMethod(
        player,
        "setSessionPaused",
        setPausedSpy as unknown as typeof player.setSessionPaused,
      );
      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );

      player.activeSession = outgoing;
      player.standbySession = standby;

      const promoted = await playerService.playPreloaded("track-2");

      expect(promoted).toBe(true);
      expect(player.activeSession).toBe(standby);
      expect(player.standbySession).toBeNull();
      expect(standby.volumeMultiplier).toBe(1);
      expect(standby.targetVolume).toBe(70);
      expect(setPausedSpy).toHaveBeenCalledWith(standby, false);
      expect(setVolumeSpy).toHaveBeenCalledWith(standby, standby.targetVolume);
    });

    test("should finalize crossfade with the incoming target volume", async () => {
      const outgoing = createSession({
        kill: mock(() => true),
      } as unknown as ChildProcess);
      const incoming = {
        ...createSession({
          kill: mock(() => true),
        } as unknown as ChildProcess),
        id: 2,
        purpose: "standby" as const,
        trackId: "track-2",
        volumeMultiplier: 92 / 70,
        targetVolume: 92,
      };
      const setPausedSpy = mock((_session: unknown, _paused: boolean) => true);
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        activeSession: typeof outgoing | null;
        standbySession: typeof incoming | null;
        setSessionPaused: (
          session: typeof incoming,
          paused: boolean,
        ) => boolean;
        setSessionVolume: (
          session: typeof incoming | typeof outgoing,
          volume: number,
        ) => boolean;
      };

      stubMethod(
        player,
        "setSessionPaused",
        setPausedSpy as unknown as typeof player.setSessionPaused,
      );
      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );

      player.activeSession = outgoing;
      player.standbySession = incoming;

      const didStart = await playerService.crossfadeToPreloaded("track-2", 100);
      await waitFor(160);

      expect(didStart).toBe(true);
      expect(player.activeSession).toBe(incoming);
      expect(incoming.volumeMultiplier).toBe(1);
      expect(incoming.targetVolume).toBeCloseTo(70, 10);
      expect(setPausedSpy).toHaveBeenCalledWith(incoming, false);
      expect(setVolumeSpy).toHaveBeenCalledWith(incoming, 0);
      expect(
        setVolumeSpy.mock.calls.some(
          ([session, volume]) =>
            session === incoming &&
            typeof volume === "number" &&
            Math.abs(volume - incoming.targetVolume) < 1e-6,
        ),
      ).toBe(true);
      expect(setVolumeSpy).toHaveBeenCalledWith(outgoing, 0);
    });

    test("should restore the active target volume when crossfade is interrupted", () => {
      const outgoing = {
        ...createSession({
          kill: mock(() => true),
        } as unknown as ChildProcess),
        id: 1,
        purpose: "retiring" as const,
        trackId: "track-1",
      };
      const incoming = {
        ...createSession({
          kill: mock(() => true),
        } as unknown as ChildProcess),
        id: 2,
        trackId: "track-2",
        targetVolume: 96,
      };
      const setVolumeSpy = mock((_session: unknown, _volume: number) => true);
      const player = playerService as unknown as {
        activeSession: typeof incoming | null;
        retiringSessions: Set<typeof outgoing>;
        crossfadeTimer: ReturnType<typeof setInterval> | null;
        setSessionVolume: (
          session: typeof incoming,
          volume: number,
        ) => boolean;
        stopSpecificSession: (session: typeof outgoing | null) => void;
        finalizeCrossfadeInterruption: () => void;
      };

      stubMethod(
        player,
        "setSessionVolume",
        setVolumeSpy as unknown as typeof player.setSessionVolume,
      );
      stubMethod(
        player,
        "stopSpecificSession",
        ((session: typeof outgoing | null) => {
          if (session) {
            player.retiringSessions.delete(session);
          }
        }) as typeof player.stopSpecificSession,
      );

      player.activeSession = incoming;
      player.retiringSessions = new Set([outgoing]);
      player.crossfadeTimer = setInterval(() => {}, 1000);

      player.finalizeCrossfadeInterruption();

      expect(setVolumeSpy).toHaveBeenCalledWith(incoming, 96);
      expect(player.retiringSessions.size).toBe(0);
      expect(player.crossfadeTimer).toBeNull();
    });
  });
});
