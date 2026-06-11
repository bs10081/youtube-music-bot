import { describe, expect, test } from "bun:test";
import api from "../routes/api.ts";
import { getAppMetadata } from "../utils/app-metadata.ts";

describe("/api/health", () => {
  test("returns ok status with version metadata", async () => {
    const response = await api.request("/health");

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      success: boolean;
      data: {
        status: string;
        version: string;
        gitSha: string;
        uptimeSeconds: number;
      };
    };

    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe("ok");
    expect(payload.data.version).toBe(getAppMetadata().appVersion);
    expect(typeof payload.data.uptimeSeconds).toBe("number");
    expect(payload.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
