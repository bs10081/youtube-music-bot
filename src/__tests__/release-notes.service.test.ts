import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ReleaseNotesService } from "../services/release-notes.service.ts";

const originalFetch = globalThis.fetch;

function stubFetch(replacement: typeof fetch): void {
  globalThis.fetch = replacement;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

describe("ReleaseNotesService", () => {
  beforeEach(() => {
    restoreFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  test("merges GitHub releases with local fallback when the current version is not published yet", async () => {
    stubFetch((async (input: string | URL | Request) => {
      expect(String(input)).toContain("/repos/bs10081/youtube-music-bot/releases");

      return new Response(
        JSON.stringify([
          {
            tag_name: "v0.6.0",
            name: "性能提升與無縫播放",
            body: [
              "Crossfade 與預加載的改版已整理到正式 release notes。",
              "",
              "## 功能增強",
              "- 新增下一首預加載機制，降低切歌時等待串流解析的停頓感。",
              "- 播放器支援可調整秒數的 Crossfade。",
            ].join("\n"),
            prerelease: false,
            draft: false,
            published_at: "2026-03-24T12:00:00Z",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch);

    const service = new ReleaseNotesService();
    const response = await service.getReleaseNotes("0.7.0");

    expect(response.source).toBe("hybrid");
    expect(response.currentRelease?.version).toBe("0.7.0");
    expect(response.releases.map((entry) => entry.version)).toContain("0.6.0");
    expect(response.warnings.some((warning) => warning.includes("v0.7.0"))).toBe(
      true,
    );

    const release060 = response.releases.find((entry) => entry.version === "0.6.0");
    expect(release060).toMatchObject({
      title: "性能提升與無縫播放",
      status: "released",
      sections: [
        {
          category: "changed",
          title: "功能增強",
          items: [
            "新增下一首預加載機制，降低切歌時等待串流解析的停頓感。",
            "播放器支援可調整秒數的 Crossfade。",
          ],
        },
      ],
    });
  });

  test("falls back to local release notes when GitHub cannot be reached", async () => {
    stubFetch((async () => {
      return new Response("upstream error", {
        status: 502,
        statusText: "Bad Gateway",
      });
    }) as unknown as typeof fetch);

    const service = new ReleaseNotesService();
    const response = await service.getReleaseNotes("0.7.0");

    expect(response.source).toBe("fallback");
    expect(response.currentRelease?.version).toBe("0.7.0");
    expect(response.releases.map((entry) => entry.version)).toContain("0.7.0");
    expect(response.releases[0]?.version).toBe("0.8.0");
    expect(
      response.warnings.some((warning) => warning.includes("已改用本機版本說明")),
    ).toBe(true);
  });
});
