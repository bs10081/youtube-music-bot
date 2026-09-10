import { describe, expect, test } from "bun:test";
import { checkMediaRange, runProbeCommand } from "../utils/playback-probe.ts";

describe("playback probe", () => {
  test("requires actual media bytes, not just a successfully extracted URL", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      expect(request.headers.get("Range")).toBe("bytes=0-1023");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206, headers: { "Content-Type": "audio/webm" },
      });
    } });
    try {
      expect(await checkMediaRange(server.url.href)).toEqual({ status: 206, contentType: "audio/webm" });
    } finally { server.stop(true); }
  });

  for (const [status, contentType, body] of [
    [403, "text/plain", "Forbidden"],
    [200, "text/html", "<html>Login</html>"],
    [206, "audio/webm", ""],
  ] as const) {
    test(`rejects unusable media (${status}, ${contentType}, ${body.length} bytes)`, async () => {
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
        fetch: () => new Response(body, { status, headers: { "Content-Type": contentType } }),
      });
      try { await expect(checkMediaRange(server.url.href)).rejects.toThrow(); }
      finally { server.stop(true); }
    });
  }

  test("captures successful command output", () => {
    expect(runProbeCommand("test", process.execPath, ["-e", "console.log('ok')"], 5000).trim()).toBe("ok");
  });
  test("fails on nonzero status without leaking child output", () => {
    expect(() => runProbeCommand("mpv", process.execPath,
      ["-e", "console.error('private-output'); process.exit(2)"], 5000,
    )).toThrow("mpv exited with code 2");
  });
  test("bounds stalled commands", () => {
    expect(() => runProbeCommand("mpv", process.execPath,
      ["-e", "setInterval(() => {}, 1000)"], 100,
    )).toThrow("mpv failed to run or timed out");
  });
});
