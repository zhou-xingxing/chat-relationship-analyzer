import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@/lib/contracts/chat";
import { DIMENSION_DEFINITIONS } from "@/server/analysis/ruleset";
import { HttpTypeSafeClient } from "./client";

const messages: ChatMessage[] = [
  {
    id: "m1",
    senderId: "a",
    timestamp: "2026-09-01T12:00:00+08:00",
    kind: "text",
    text: "虚构消息",
  },
];

function validResponse() {
  return {
    model: "jev-1.13.0",
    answers: {
      relationship_broad: {
        type: "choice",
        choice: "friendship",
        confidence: 0.8,
        probabilities: {
          romantic_or_partner: 0.05,
          friendship: 0.7,
          family: 0.05,
          work_or_education: 0.05,
          commercial_or_service: 0.05,
          weak_tie_or_new_contact: 0.05,
          other: 0.02,
          unclear: 0.03,
        },
      },
      ...Object.fromEntries(
        DIMENSION_DEFINITIONS.map(({ id }) => [
          id,
          {
            type: "score",
            score: 2.2,
            confidence: 0.8,
            legend: { "0": "无", "1": "少", "2": "中", "3": "多", "4": "强" },
            probabilities: { "0": 0.05, "1": 0.1, "2": 0.65, "3": 0.15, "4": 0.05 },
          },
        ]),
      ),
    },
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe("TypeSafe HTTP 适配器", () => {
  it("适配官方响应并只在响应无效时进行一次修复重试", async () => {
    const invalid = validResponse();
    delete (invalid.answers as Record<string, unknown>).a_engagement;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(invalid), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const client = new HttpTypeSafeClient({ apiKey: "test", fetchImpl });
    const result = await client.analyzePrimary(messages);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.broad.selectedId).toBe("friendship");
    expect(result.dimensions).toHaveLength(10);
    expect(result.dimensions[0].score).toBe(2);
  });

  it("网络失败不触发格式修复重试", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const client = new HttpTypeSafeClient({ apiKey: "test", fetchImpl });
    await expect(client.analyzePrimary(messages)).rejects.toMatchObject({
      source: "typesafe",
      kind: "request_failed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
