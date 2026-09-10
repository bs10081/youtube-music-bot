import { spawnSync } from "node:child_process";

/** Probe-only subprocess runner. Never print signed URLs or child output on failure. */
export function runProbeCommand(
  label: string, executable: string, args: string[], timeout: number,
): string {
  const result = spawnSync(executable, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${label} failed to run or timed out`);
  if (result.status !== 0) throw new Error(`${label} exited with code ${result.status ?? "unknown"}`);
  return result.stdout;
}

/** A URL is not playable evidence until a bounded media request returns bytes. */
export async function checkMediaRange(url: string): Promise<{ status: number; contentType: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Media request failed or timed out");
  }
  const contentType = response.headers.get("content-type") ?? "";
  const reader = response.body?.getReader();
  try {
    if (!response.ok) throw new Error(`Media request returned HTTP ${response.status}`);
    if (!/^(audio\/|video\/|application\/(octet-stream|vnd\.apple\.mpegurl|x-mpegurl))/i.test(contentType)) {
      throw new Error("Media request returned a non-media content type");
    }
    const chunk = await reader?.read();
    if (!chunk?.value?.byteLength) throw new Error("Media request returned no bytes");
    return { status: response.status, contentType };
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
