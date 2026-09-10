import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import api from "../routes/api.ts";
import {
  __resetReleaseNotesServiceForTests,
  getReleaseNotesService,
} from "../services/release-notes.service.ts";
import type { ReleaseNotesResponse } from "../types/index.ts";

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

describe("/api/system/info", () => {
  beforeEach(() => {
    restoreMethods();
    __resetReleaseNotesServiceForTests();
  });

  afterEach(() => {
    restoreMethods();
    __resetReleaseNotesServiceForTests();
  });

  test("should expose app version metadata", async () => {
    const response = await api.request("/system/info");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      success: boolean;
      data: {
        appVersion: string;
        gitSha: string;
        buildVersion: string;
        environment: string;
        runtimeDependencies: {
          deno: { available: boolean; executable: string };
          mpv: {
            available: boolean;
            executable: string;
            version?: string;
            error?: string;
          };
          ytDlp: {
            available: boolean;
            executable: string;
            version?: string;
            extractorArgs: string;
            cookiesConfigured: boolean;
            cookiesReadable: boolean;
            error?: string;
          };
        };
      };
    };

    expect(payload.success).toBe(true);
    expect(payload.data.appVersion).toBeTruthy();
    expect(payload.data.gitSha).toBeTruthy();
    expect(payload.data.buildVersion).toContain(payload.data.appVersion);
    expect(payload.data.environment).toBeTruthy();
    expect(payload.data.runtimeDependencies.deno.executable).toBeTruthy();
    expect(typeof payload.data.runtimeDependencies.deno.available).toBe("boolean");
    expect(payload.data.runtimeDependencies.mpv.executable).toBeTruthy();
    expect(payload.data.runtimeDependencies.ytDlp.executable).toBeTruthy();
    expect(payload.data.runtimeDependencies.ytDlp.extractorArgs).toBeTruthy();
    expect(typeof payload.data.runtimeDependencies.ytDlp.cookiesConfigured).toBe(
      "boolean",
    );
    expect(typeof payload.data.runtimeDependencies.ytDlp.cookiesReadable).toBe(
      "boolean",
    );
  });

  test("should expose release notes through the system api", async () => {
    const releaseNotesService = getReleaseNotesService();
    const payload: ReleaseNotesResponse = {
      currentVersion: "0.7.0",
      currentRelease: {
        version: "0.7.0",
        title: "Discover 多市場探索",
        publishedAt: "2026-03-28",
        status: "preview",
        summary: "Summary",
        sections: [
          {
            category: "added",
            title: "全新功能",
            items: ["新增 Discover 頁面"],
          },
        ],
      },
      releases: [],
      source: "github",
      fetchedAt: "2026-03-28T00:00:00.000Z",
      warnings: [],
      repository: {
        owner: "bs10081",
        name: "youtube-music-bot",
        url: "https://github.com/bs10081/youtube-music-bot",
      },
    };

    stubMethod(
      releaseNotesService,
      "getReleaseNotes",
      (async (currentVersion: string) => {
        expect(currentVersion).toBeTruthy();
        return payload;
      }) as typeof releaseNotesService.getReleaseNotes,
    );

    const response = await api.request("/system/release-notes");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: payload,
    });
  });
});
