import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeSignals, generateExplanation } = vi.hoisted(() => ({
  analyzeSignals: vi.fn(),
  generateExplanation: vi.fn(),
}));

vi.mock("@/server/analysis/signals-service", () => ({ analyzeSignals }));
vi.mock("@/server/analysis/explanation-service", () => ({ generateExplanation }));

import { POST as postExplanation } from "./explanation/route";
import { POST as postSignals } from "./signals/route";

describe("公开分析接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("signals 返回服务层结果、请求 ID 与 no-store", async () => {
    analyzeSignals.mockImplementation(async (_body, dependencies) => ({
      ok: true,
      requestId: dependencies.requestId(),
    }));

    const response = await postSignals(
      new Request("http://localhost/api/analyze/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("explanation 拒绝非法 JSON 且不调用服务层", async () => {
    const response = await postExplanation(
      new Request("http://localhost/api/analyze/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(generateExplanation).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });
});
